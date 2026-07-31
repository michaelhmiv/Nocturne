import { createHash, randomUUID } from "node:crypto";
import {
  MaterializationProposalSchema,
  MaterializationResultSchema,
  type MaterializationProposal,
  type MaterializationResult,
  type MaterializationSourceCandidate,
} from "@nocturne/contracts";
import type { UniversalOperationExecutor } from "./universal-operation-executor.js";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";
import type { WorldScope } from "./world-store.js";

export class MaterializationStoreError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "request_conflict"
      | "source_not_found"
      | "source_depleted"
      | "proposal_rejected"
      | "commit_failed",
    message: string,
  ) {
    super(message);
    this.name = "MaterializationStoreError";
  }
}

const fingerprintFor = (input: {
  locationId: string;
  sourceId: string;
  proposal: MaterializationProposal;
}) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        locationId: input.locationId,
        sourceId: input.sourceId,
        definition: input.proposal.definition,
        instance: input.proposal.instance,
        basis: input.proposal.semanticFingerprintBasis.map((value) =>
          value.trim().replace(/\s+/g, " ").toLowerCase(),
        ),
      }),
    )
    .digest("hex");

export function createMaterializationStore(
  database: ReturnType<typeof createDatabase>,
  executor: UniversalOperationExecutor,
) {
  async function listSources(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    locationId: string;
  }): Promise<MaterializationSourceCandidate[]> {
    const rows = await database.client<
      {
        source_id: string;
        source_type: MaterializationSourceCandidate["sourceType"];
        location_instance_id: string;
        name: string;
        description: string;
        semantic_scope: Record<string, unknown>;
        constraints: string[];
        capacity: string;
        rarity_policy: Record<string, unknown>;
        metadata: Record<string, unknown>;
      }[]
    >`
      WITH RECURSIVE location_chain(instance_id, depth) AS (
        SELECT ${input.locationId}::uuid, 0
        UNION ALL
        SELECT parent.location_id, chain.depth + 1
        FROM location_chain chain
        JOIN game.entity_instances parent
          ON parent.instance_id = chain.instance_id
        WHERE parent.location_id IS NOT NULL AND chain.depth < 8
      )
      SELECT source.source_id, source.source_type, source.location_instance_id,
             source.name, source.description, source.semantic_scope,
             source.constraints, source.capacity::text, source.rarity_policy,
             source.metadata
      FROM game.materialization_sources source
      JOIN location_chain chain ON chain.instance_id = source.location_instance_id
      WHERE source.world_id = ${input.scope.worldId}
        AND source.shard_id = ${input.scope.shardId}
        AND source.status = 'active'
        AND source.capacity > 0
      ORDER BY chain.depth, source.created_at
      LIMIT 32
    `;
    return rows.map((row) => ({
      sourceId: row.source_id,
      sourceType: row.source_type,
      locationId: row.location_instance_id,
      name: row.name,
      description: row.description,
      semanticScope: row.semantic_scope || {},
      constraints: Array.isArray(row.constraints) ? row.constraints : [],
      capacity: Number(row.capacity),
      rarityPolicy: row.rarity_policy || {},
      metadata: row.metadata || {},
    }));
  }

  async function findExistingCompatible(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    locationId: string;
    requestedConcept: string;
    viewpointId?: string;
  }) {
    const concept = input.requestedConcept.trim().replace(/\s+/g, " ").toLowerCase();
    if (!concept) return [];
    const tokens = concept
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3)
      .slice(0, 8);
    const patterns = [`%${concept}%`, ...tokens.map((token) => `%${token}%`)];
    const rows = await database.client<
      {
        instance_id: string;
        definition_id: string;
        name: string;
        concept_summary: string;
        lifecycle_status: string;
        condition: number;
        state: Record<string, unknown>;
        already_observed: boolean;
      }[]
    >`
      SELECT instance.instance_id, instance.definition_id, definition.name,
             definition.concept_summary, instance.lifecycle_status,
             instance.condition, instance.state,
             EXISTS (
               SELECT 1
               FROM game.entity_relations observation
               WHERE observation.world_id = instance.world_id
                 AND observation.source_instance_id = ${input.viewpointId || null}
                 AND observation.target_instance_id = instance.instance_id
                 AND observation.relation_type = 'observed'
             ) AS already_observed
      FROM game.entity_instances instance
      JOIN game.entity_definitions definition
        ON definition.definition_id = instance.definition_id
      WHERE instance.world_id = ${input.scope.worldId}
        AND instance.shard_id = ${input.scope.shardId}
        AND instance.location_id = ${input.locationId}
        AND instance.lifecycle_status IN ('active', 'dormant', 'incapacitated', 'missing')
        AND EXISTS (
          SELECT 1
          FROM unnest(${patterns}::text[]) pattern
          WHERE lower(definition.name || ' ' || definition.concept_summary) LIKE pattern
        )
      ORDER BY already_observed DESC, instance.updated_at DESC
      LIMIT 12
    `;
    return rows.map((row) => ({
      entityId: row.instance_id,
      definitionId: row.definition_id,
      name: row.name,
      conceptSummary: row.concept_summary,
      lifecycleStatus: row.lifecycle_status,
      condition: row.condition,
      state: row.state || {},
      alreadyObserved: row.already_observed,
    }));
  }

  async function reserveSource(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    sourceId: string;
    units?: number;
  }) {
    const units = input.units ?? 1;
    const rows = await database.client<{ version: string; capacity: string }[]>`
      UPDATE game.materialization_sources
      SET capacity = capacity - ${units},
          status = CASE WHEN capacity - ${units} <= 0 THEN 'depleted' ELSE status END,
          version = version + 1,
          updated_at = now()
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND source_id = ${input.sourceId}
        AND status = 'active'
        AND capacity >= ${units}
      RETURNING version::text, capacity::text
    `;
    if (!rows[0]) {
      const exists = await database.client`
        SELECT 1
        FROM game.materialization_sources
        WHERE world_id = ${input.scope.worldId}
          AND shard_id = ${input.scope.shardId}
          AND source_id = ${input.sourceId}
      `;
      throw new MaterializationStoreError(
        exists[0] ? "source_depleted" : "source_not_found",
        exists[0] ? "Materialization source is depleted." : "Materialization source not found.",
      );
    }
    return { version: Number(rows[0].version), capacity: Number(rows[0].capacity) };
  }

  async function refundSource(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    sourceId: string;
    units?: number;
  }) {
    const units = input.units ?? 1;
    await database.client`
      UPDATE game.materialization_sources
      SET capacity = LEAST(maximum_capacity, capacity + ${units}),
          status = CASE WHEN capacity + ${units} > 0 THEN 'active' ELSE status END,
          version = version + 1,
          updated_at = now()
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND source_id = ${input.sourceId}
    `;
  }

  async function beginRequest(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    idempotencyKey: string;
    actorId?: string;
    locationId: string;
    requestedConcept: string;
    authoritativeContext: Record<string, unknown>;
  }) {
    const requestId = randomUUID();
    const rows = await database.client<
      {
        request_id: string;
        location_instance_id: string;
        requested_concept: string;
        status: string;
        existing_entity_id: string | null;
        materialized_entity_id: string | null;
        error_code: string | null;
      }[]
    >`
      INSERT INTO game.materialization_requests (
        request_id, world_id, shard_id, idempotency_key, actor_id,
        location_instance_id, requested_concept, authoritative_context, status
      ) VALUES (
        ${requestId}, ${input.scope.worldId}, ${input.scope.shardId},
        ${input.idempotencyKey}, ${input.actorId || null}, ${input.locationId},
        ${input.requestedConcept}, ${json(input.authoritativeContext)}::jsonb, 'pending'
      )
      ON CONFLICT (world_id, idempotency_key) DO UPDATE
      SET idempotency_key = EXCLUDED.idempotency_key
      RETURNING request_id, location_instance_id, requested_concept, status,
                existing_entity_id, materialized_entity_id, error_code
    `;
    const row = rows[0];
    if (!row) throw new MaterializationStoreError("commit_failed", "Request reservation failed.");
    if (
      row.location_instance_id !== input.locationId ||
      row.requested_concept !== input.requestedConcept
    ) {
      throw new MaterializationStoreError(
        "request_conflict",
        "Idempotency key was used for another materialization request.",
      );
    }
    return row;
  }

  async function selectExisting(input: {
    requestId: string;
    entityId: string;
  }): Promise<MaterializationResult> {
    const rows = await database.client<{ request_id: string }[]>`
      UPDATE game.materialization_requests request
      SET status = 'existing_selected', existing_entity_id = ${input.entityId},
          completed_at = now()
      WHERE request.request_id = ${input.requestId}
        AND request.status IN ('pending', 'proposed')
        AND EXISTS (
          SELECT 1 FROM game.entity_instances entity
          WHERE entity.instance_id = ${input.entityId}
            AND entity.world_id = request.world_id
            AND entity.shard_id = request.shard_id
            AND entity.location_id = request.location_instance_id
        )
      RETURNING request_id
    `;
    if (!rows[0]) {
      throw new MaterializationStoreError(
        "commit_failed",
        "Existing entity selection became stale.",
      );
    }
    return MaterializationResultSchema.parse({
      kind: "existing",
      requestId: input.requestId,
      entityId: input.entityId,
    });
  }

  async function commitProposal(input: {
    scope: WorldScope;
    requestId: string;
    idempotencyKey: string;
    actorId?: string;
    locationId: string;
    proposal: MaterializationProposal;
    preconditionFactIds: string[];
  }): Promise<MaterializationResult> {
    const proposal = MaterializationProposalSchema.parse(input.proposal);
    if (proposal.decision === "reject") {
      await database.client`
        UPDATE game.materialization_requests
        SET status = 'rejected', proposal = ${json(proposal)}::jsonb,
            validation_result = ${json({ valid: true })}::jsonb,
            error_code = NULL, completed_at = now()
        WHERE request_id = ${input.requestId}
          AND world_id = ${input.scope.worldId}
          AND status IN ('pending', 'proposed')
      `;
      return MaterializationResultSchema.parse({
        kind: "rejected",
        requestId: input.requestId,
        reason: proposal.rejectionReason!,
      });
    }

    const sourceId = proposal.selectedSourceId!;
    const definition = proposal.definition!;
    const instance = proposal.instance!;
    const fingerprint = fingerprintFor({ locationId: input.locationId, sourceId, proposal });
    await database.client`
      UPDATE game.materialization_requests
      SET status = 'proposed', proposal = ${json(proposal)}::jsonb,
          validation_result = ${json({ valid: true, semanticFingerprint: fingerprint })}::jsonb,
          selected_source_id = ${sourceId}
      WHERE request_id = ${input.requestId}
        AND world_id = ${input.scope.worldId}
        AND status = 'pending'
    `;

    await reserveSource({ scope: input.scope, sourceId });
    try {
      const definitionOperations = definition.reuseDefinitionId
        ? []
        : [
            {
              type: "create_definition" as const,
              symbol: "materialized_definition",
              definitionType: definition.definitionType,
              name: definition.name,
              conceptSummary: definition.conceptSummary,
              originSource: "dynamic_materialization",
              lifecycleStatus: "approved" as const,
              preconditionFactIds: input.preconditionFactIds,
            },
            {
              type: "create_revision" as const,
              symbol: "materialized_revision",
              definitionRef: { kind: "symbol" as const, symbol: "materialized_definition" },
              schemaVersion: "materialized-entity-v1",
              payload: definition.revisionPayload,
              changeSummary: "Create reusable semantics for materialized entity",
              preconditionFactIds: input.preconditionFactIds,
            },
          ];
      const definitionRef = definition.reuseDefinitionId
        ? { kind: "existing" as const, definitionId: definition.reuseDefinitionId }
        : { kind: "symbol" as const, symbol: "materialized_definition" };
      const receipt = await executor.execute({
        scope: input.scope,
        authority: input.actorId ? "player" : "world_simulation",
        actorId: input.actorId,
        idempotencyKey: `${input.idempotencyKey}:materialize`,
        declaredFactIds: input.preconditionFactIds,
        playerVisibleFacts: proposal.narrationFacts,
        hiddenFacts: proposal.assumptions,
        branch: {
          operations: [
            ...definitionOperations,
            {
              type: "create_instance",
              symbol: "materialized_entity",
              definitionRef,
              locationRef: { kind: "existing", entityId: input.locationId },
              condition: instance.condition,
              state: {
                ...instance.state,
                identity: {
                  displayName: instance.displayName,
                  distinguishingTraits: instance.distinguishingTraits,
                  semanticFingerprint: fingerprint,
                },
              },
              provenance: {
                sourceType: "population_reservoir",
                sourceId,
                policyVersion: "materialization-v1",
                inputHash: fingerprint,
                payload: {
                  requestId: input.requestId,
                  semanticFingerprintBasis: proposal.semanticFingerprintBasis,
                },
              },
              preconditionFactIds: input.preconditionFactIds,
            },
          ],
        },
      });
      const entityId = receipt.symbolMap.materialized_entity;
      if (!entityId) {
        throw new MaterializationStoreError(
          "commit_failed",
          "Materialization receipt did not contain an entity ID.",
        );
      }
      await database.client.begin(async (sql) => {
        const requests = await sql`
          SELECT 1
          FROM game.materialization_requests
          WHERE request_id = ${input.requestId}
            AND world_id = ${input.scope.worldId}
            AND status = 'proposed'
          FOR UPDATE
        `;
        if (!requests[0]) {
          throw new MaterializationStoreError(
            "commit_failed",
            "Materialization request was superseded.",
          );
        }
        await sql`
          INSERT INTO game.materialization_history (
            world_id, shard_id, source_id, request_id, entity_instance_id,
            units_consumed, semantic_fingerprint, event_id
          ) VALUES (
            ${input.scope.worldId}, ${input.scope.shardId}, ${sourceId},
            ${input.requestId}, ${entityId}, 1, ${fingerprint}, ${receipt.eventId}
          )
        `;
        await sql`
          UPDATE game.materialization_requests
          SET status = 'materialized', materialized_entity_id = ${entityId},
              source_event_id = ${receipt.eventId}, completed_at = now()
          WHERE request_id = ${input.requestId}
        `;
      });
      return MaterializationResultSchema.parse({
        kind: "materialized",
        requestId: input.requestId,
        entityId,
        eventId: receipt.eventId,
        sourceId,
        semanticFingerprint: fingerprint,
      });
    } catch (error) {
      await refundSource({ scope: input.scope, sourceId }).catch(() => {});
      await database.client`
        UPDATE game.materialization_requests
        SET status = 'failed', error_code = ${
          error instanceof MaterializationStoreError ? error.code : "commit_failed"
        }
        WHERE request_id = ${input.requestId}
          AND status IN ('pending', 'proposed')
      `.catch(() => {});
      throw error;
    }
  }

  return {
    listSources,
    findExistingCompatible,
    reserveSource,
    refundSource,
    beginRequest,
    selectExisting,
    commitProposal,
  };
}

export type MaterializationStore = ReturnType<typeof createMaterializationStore>;
