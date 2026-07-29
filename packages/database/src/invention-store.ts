import { randomUUID } from "node:crypto";
import type {
  GeneratedDefinitionDraft,
  InstallationEvaluation,
  InventionSummary,
} from "@nocturne/contracts";
import type { ContentValidationResult } from "@nocturne/content-engine";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";

export class InventionStoreError extends Error {
  constructor(
    readonly code: "not_found" | "forbidden" | "invalid_state" | "installation_failed",
    message: string,
  ) {
    super(message);
    this.name = "InventionStoreError";
  }
}

function iso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function mapRequest(row: Record<string, unknown>): InventionSummary {
  return {
    requestId: String(row.request_id),
    characterId: String(row.creator_id),
    rawConcept: String(row.raw_concept),
    status: String(row.validation_status),
    definitionId: row.definition_id ? String(row.definition_id) : null,
    installedInstanceId: row.installed_instance_id ? String(row.installed_instance_id) : null,
    draft: (row.draft_payload as GeneratedDefinitionDraft | null) ?? null,
    validation: (row.validation_result as Record<string, unknown> | null) ?? null,
    installation: (row.installation_result as InstallationEvaluation | null) ?? null,
    createdAt: new Date(row.created_at as Date).toISOString(),
    completedAt: iso(row.completed_at as Date | null),
  };
}

export function createInventionStore(database: ReturnType<typeof createDatabase>) {
  async function assertControlled(userId: string, characterId: string, residenceId?: string) {
    const rows = await database.client`
      SELECT pc.character_instance_id, o.residence_instance_id
      FROM game.player_characters pc
      LEFT JOIN game.residence_occupancies o
        ON o.character_instance_id = pc.character_instance_id AND o.status = 'active'
      WHERE pc.user_id = ${userId} AND pc.character_instance_id = ${characterId}
    `;
    if (!rows[0]) {
      throw new InventionStoreError("forbidden", "Character is not controlled by this account.");
    }
    if (residenceId && String(rows[0].residence_instance_id || "") !== residenceId) {
      throw new InventionStoreError(
        "forbidden",
        "Character does not occupy the requested residence.",
      );
    }
  }

  async function createRequest(input: {
    userId: string;
    characterId: string;
    residenceId?: string;
    rawConcept: string;
    context: Record<string, unknown>;
  }): Promise<string> {
    await assertControlled(input.userId, input.characterId, input.residenceId);
    const requestId = randomUUID();
    await database.client`
      INSERT INTO game.generated_content_requests (
        request_id, creator_id, user_id, residence_instance_id, raw_concept, context, validation_status
      ) VALUES (
        ${requestId}, ${input.characterId}, ${input.userId}, ${input.residenceId || null},
        ${input.rawConcept}, ${json(input.context)}, 'normalizing'
      )
    `;
    return requestId;
  }

  async function startAiRun(input: {
    task: string;
    requestedModel: string;
    policyVersion: string;
    inputHash: string;
    metadata: Record<string, unknown>;
  }): Promise<string> {
    const runId = randomUUID();
    await database.client`
      INSERT INTO system.ai_runs (
        run_id, task, authority, requested_model, prompt_policy_version, status, input_hash, metadata
      ) VALUES (
        ${runId}, ${input.task}, 'authoritative', ${input.requestedModel}, ${input.policyVersion},
        'running', ${input.inputHash}, ${json(input.metadata)}
      )
    `;
    return runId;
  }

  async function finishAiRun(
    runId: string,
    input: { actualModel: string; providerRequestId?: string; outputHash: string },
  ) {
    await database.client`
      UPDATE system.ai_runs
      SET actual_model = ${input.actualModel},
          provider_request_id = ${input.providerRequestId || null},
          output_hash = ${input.outputHash},
          status = 'completed',
          completed_at = now()
      WHERE run_id = ${runId}
    `;
  }

  async function failAiRun(runId: string, errorCode: string) {
    await database.client`
      UPDATE system.ai_runs
      SET status = 'failed', error_code = ${errorCode}, completed_at = now()
      WHERE run_id = ${runId}
    `;
  }

  async function saveNormalization(input: {
    requestId: string;
    userId: string;
    draft: GeneratedDefinitionDraft;
    validation: ContentValidationResult;
    installation: InstallationEvaluation | null;
  }): Promise<InventionSummary> {
    return database.client.begin(async (sql) => {
      const requests = await sql`
        SELECT * FROM game.generated_content_requests
        WHERE request_id = ${input.requestId} AND user_id = ${input.userId}
        FOR UPDATE
      `;
      const request = requests[0];
      if (!request) {
        throw new InventionStoreError("not_found", "Generated-content request not found.");
      }

      const canPersist = input.validation.status !== "invalid" && !input.validation.requiresReview;
      let definitionId: string | null = null;
      if (canPersist) {
        definitionId = `CUST-${input.draft.definitionType
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "-")}-${randomUUID()}`;
        const revisionId = randomUUID();
        await sql`
          INSERT INTO game.entity_definitions (
            definition_id, definition_type, name, concept_summary, origin_source, lifecycle_status
          ) VALUES (
            ${definitionId}, ${input.draft.definitionType}, ${input.draft.name},
            ${input.draft.conceptSummary}, ${input.draft.originSource}, 'provisional'
          )
        `;
        await sql`
          INSERT INTO game.definition_revisions (
            revision_id, definition_id, payload, change_summary, created_by
          ) VALUES (
            ${revisionId}, ${definitionId}, ${json(input.draft)},
            'Normalize player-created content', ${request.creator_id}
          )
        `;
        await sql`
          UPDATE game.entity_definitions
          SET current_revision_id = ${revisionId}, updated_at = now()
          WHERE definition_id = ${definitionId}
        `;
      }

      const status =
        input.validation.status === "invalid"
          ? "invalid"
          : input.validation.requiresReview
            ? "review_required"
            : "normalized";
      await sql`
        UPDATE game.generated_content_requests
        SET draft_payload = ${json(input.draft)},
            validation_result = ${json(input.validation)},
            installation_result = ${input.installation ? json(input.installation) : null},
            validation_status = ${status},
            definition_id = ${definitionId},
            completed_at = now(),
            updated_at = now()
        WHERE request_id = ${input.requestId}
      `;
      if (input.installation) {
        await sql`
          INSERT INTO game.installation_evaluations (
            request_id, character_instance_id, residence_instance_id, result
          ) VALUES (
            ${input.requestId}, ${request.creator_id}, ${request.residence_instance_id},
            ${json(input.installation)}
          )
        `;
      }
      await sql`
        INSERT INTO game.event_ledger (
          idempotency_key, world_time, event_type, involved_entity_ids, payload
        ) VALUES (
          ${`normalize:${input.requestId}`}, now(), 'content_normalized',
          ${json([String(request.creator_id), ...(definitionId ? [definitionId] : [])])},
          ${json({ requestId: input.requestId, definitionId, status, validation: input.validation })}
        )
        ON CONFLICT (idempotency_key) DO NOTHING
      `;
      const updated = await sql`
        SELECT * FROM game.generated_content_requests
        WHERE request_id = ${input.requestId} AND user_id = ${input.userId}
      `;
      return mapRequest(updated[0] as Record<string, unknown>);
    });
  }

  async function markFailed(requestId: string, userId: string, errorCode: string) {
    await database.client`
      UPDATE game.generated_content_requests
      SET validation_status = 'failed', error_code = ${errorCode},
          completed_at = now(), updated_at = now()
      WHERE request_id = ${requestId} AND user_id = ${userId}
    `;
  }

  async function install(input: {
    requestId: string;
    userId: string;
    characterId: string;
    residenceId: string;
    evaluation: InstallationEvaluation;
    idempotencyKey: string;
  }): Promise<InventionSummary> {
    await assertControlled(input.userId, input.characterId, input.residenceId);
    if (!input.evaluation.fits) {
      throw new InventionStoreError(
        "installation_failed",
        "The residence does not satisfy installation requirements.",
      );
    }

    const prior = await database.client`
      SELECT 1 FROM game.event_ledger WHERE idempotency_key = ${input.idempotencyKey}
    `;
    if (prior[0]) return getRequest(input.userId, input.requestId);

    return database.client.begin(async (sql) => {
      const requests = await sql`
        SELECT * FROM game.generated_content_requests
        WHERE request_id = ${input.requestId} AND user_id = ${input.userId}
        FOR UPDATE
      `;
      const request = requests[0];
      if (!request?.definition_id || !request.draft_payload) {
        throw new InventionStoreError("invalid_state", "Request has no installable definition.");
      }
      if (String(request.creator_id) !== input.characterId) {
        throw new InventionStoreError("forbidden", "Invention belongs to a different character.");
      }
      if (request.installed_instance_id) {
        return mapRequest(request as Record<string, unknown>);
      }

      const instanceId = randomUUID();
      const eventId = randomUUID();
      await sql`
        INSERT INTO game.entity_instances (
          instance_id, definition_id, owner_id, controller_id, location_id, condition, state
        ) VALUES (
          ${instanceId}, ${request.definition_id}, ${input.characterId}, ${input.characterId},
          ${input.residenceId}, 100,
          ${json({ installed: true, operationalState: "inactive", requestId: input.requestId })}
        )
      `;
      await sql`
        INSERT INTO game.entity_relations (
          source_instance_id, target_instance_id, relation_type, parameters
        ) VALUES (
          ${instanceId}, ${input.residenceId}, 'installed_in',
          ${json({ evaluation: input.evaluation })}
        )
      `;
      await sql`
        INSERT INTO game.event_ledger (
          event_id, idempotency_key, world_time, event_type, involved_entity_ids, payload
        ) VALUES (
          ${eventId}, ${input.idempotencyKey}, now(), 'invention_installed',
          ${json([input.characterId, input.residenceId, instanceId])},
          ${json({
            requestId: input.requestId,
            definitionId: request.definition_id,
            instanceId,
            evaluation: input.evaluation,
          })}
        )
      `;
      await sql`
        UPDATE game.entity_instances SET created_event_id = ${eventId}
        WHERE instance_id = ${instanceId}
      `;
      await sql`
        UPDATE game.generated_content_requests
        SET installed_instance_id = ${instanceId}, validation_status = 'installed', updated_at = now()
        WHERE request_id = ${input.requestId}
      `;
      const updated = await sql`
        SELECT * FROM game.generated_content_requests
        WHERE request_id = ${input.requestId} AND user_id = ${input.userId}
      `;
      return mapRequest(updated[0] as Record<string, unknown>);
    });
  }

  async function getResidenceCapacities(
    userId: string,
    characterId: string,
    residenceId: string,
  ): Promise<Record<string, number>> {
    await assertControlled(userId, characterId, residenceId);
    const rows = await database.client`
      SELECT r.payload
      FROM game.entity_instances i
      JOIN game.entity_definitions d ON d.definition_id = i.definition_id
      JOIN game.definition_revisions r ON r.revision_id = d.current_revision_id
      WHERE i.instance_id = ${residenceId}
    `;
    const payload = rows[0]?.payload as
      { extensionPayload?: { capacities?: Record<string, number> } } | undefined;
    return payload?.extensionPayload?.capacities ?? {};
  }

  async function getRequest(userId: string, requestId: string): Promise<InventionSummary> {
    const rows = await database.client`
      SELECT * FROM game.generated_content_requests
      WHERE request_id = ${requestId} AND user_id = ${userId}
    `;
    if (!rows[0]) {
      throw new InventionStoreError("not_found", "Generated-content request not found.");
    }
    return mapRequest(rows[0] as Record<string, unknown>);
  }

  async function listRequests(userId: string): Promise<InventionSummary[]> {
    const rows = await database.client`
      SELECT * FROM game.generated_content_requests
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `;
    return rows.map((row) => mapRequest(row as Record<string, unknown>));
  }

  return {
    createRequest,
    startAiRun,
    finishAiRun,
    failAiRun,
    saveNormalization,
    markFailed,
    install,
    getResidenceCapacities,
    getRequest,
    listRequests,
  };
}

export type InventionStore = ReturnType<typeof createInventionStore>;
