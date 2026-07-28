import { randomUUID } from "node:crypto";
import type {
  ActionExecutionResponse,
  ActionIntent,
  GeneratedDefinitionDraft,
  ResolutionResult,
  StateOperation,
} from "@nocturne/contracts";
import { StateOperationSchema } from "@nocturne/contracts";
import { STARTER_WORLD_IDS } from "./game-store.js";
import type { createDatabase } from "./index.js";

const ALLEY_TARGET = {
  definitionId: "WORLD-ALLEY-CONTACT",
  revisionId: "60000000-0000-4000-8000-000000000001",
  instanceId: "60000000-0000-4000-8000-000000000002",
};

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

export interface ActionRuntimeContext {
  actor: { id: string; name: string };
  residence: { id: string; name: string };
  targetLocation: {
    id: string;
    name: string;
    environment: { clutter: number; darkness: number; coverageSupport: number };
  };
  method: {
    instanceId: string;
    definitionId: string;
    name: string;
    condition: number;
    state: Record<string, unknown>;
    draft: GeneratedDefinitionDraft;
    installed: boolean;
  };
  publicContext: Record<string, unknown>;
  publicFacts: string[];
  hiddenMechanics: {
    targetId: string;
    concealment: number;
    countermeasure: number;
    hiddenFacts: string[];
  };
}

export class ActionStoreError extends Error {
  constructor(
    readonly code: "not_found" | "forbidden" | "invalid_method" | "duplicate",
    message: string,
  ) {
    super(message);
    this.name = "ActionStoreError";
  }
}

export function createActionStore(database: ReturnType<typeof createDatabase>) {
  async function seedAlleyScenario() {
    await database.client.begin(async (sql) => {
      await sql`
        INSERT INTO game.entity_definitions (
          definition_id, definition_type, name, concept_summary, origin_source, lifecycle_status
        ) VALUES (
          ${ALLEY_TARGET.definitionId}, 'npc', 'Unknown Alley Contact',
          'A concealed person moving through the rear alley during the starter scenario.',
          'human', 'approved'
        ) ON CONFLICT (definition_id) DO NOTHING
      `;
      await sql`
        INSERT INTO game.definition_revisions (
          revision_id, definition_id, payload, change_summary
        ) VALUES (
          ${ALLEY_TARGET.revisionId}, ${ALLEY_TARGET.definitionId},
          ${json({
            definitionType: "npc",
            name: "Unknown Alley Contact",
            conceptSummary: "Hidden starter-scenario contact",
            extensionPayload: { concealment: 3, countermeasure: 0 },
          })},
          'Seed alley contact'
        ) ON CONFLICT (revision_id) DO NOTHING
      `;
      await sql`
        UPDATE game.entity_definitions
        SET current_revision_id = ${ALLEY_TARGET.revisionId}, updated_at = now()
        WHERE definition_id = ${ALLEY_TARGET.definitionId}
      `;
      await sql`
        INSERT INTO game.entity_instances (
          instance_id, definition_id, location_id, condition, state
        ) VALUES (
          ${ALLEY_TARGET.instanceId}, ${ALLEY_TARGET.definitionId}, ${STARTER_WORLD_IDS.alley},
          100, ${json({ active: true, concealment: 3, countermeasure: 0 })}
        ) ON CONFLICT (instance_id) DO NOTHING
      `;
    });
  }

  async function getContext(
    userId: string,
    actorId: string,
    requestedMethodId?: string,
    requestedTargetId?: string,
  ): Promise<ActionRuntimeContext> {
    await seedAlleyScenario();
    const actorRows = await database.client`
      SELECT d.name, o.residence_instance_id, rd.name AS residence_name
      FROM game.player_characters pc
      JOIN game.entity_instances actor ON actor.instance_id = pc.character_instance_id
      JOIN game.entity_definitions d ON d.definition_id = actor.definition_id
      LEFT JOIN game.residence_occupancies o
        ON o.character_instance_id = actor.instance_id AND o.status = 'active'
      LEFT JOIN game.entity_instances ri ON ri.instance_id = o.residence_instance_id
      LEFT JOIN game.entity_definitions rd ON rd.definition_id = ri.definition_id
      WHERE pc.user_id = ${userId} AND pc.character_instance_id = ${actorId}
    `;
    const actor = actorRows[0];
    if (!actor) {
      throw new ActionStoreError("forbidden", "Character is not controlled by this account.");
    }
    if (!actor.residence_instance_id) {
      throw new ActionStoreError(
        "invalid_method",
        "Character has no residence for an installed-system action.",
      );
    }

    const targetLocationId = requestedTargetId || STARTER_WORLD_IDS.alley;
    if (targetLocationId !== STARTER_WORLD_IDS.alley) {
      throw new ActionStoreError(
        "forbidden",
        "The first action slice is limited to the residence's rear alley.",
      );
    }

    const methods = await database.client`
      SELECT i.instance_id, i.definition_id, i.condition, i.state, d.name, r.payload
      FROM game.entity_instances i
      JOIN game.entity_definitions d ON d.definition_id = i.definition_id
      JOIN game.definition_revisions r ON r.revision_id = d.current_revision_id
      JOIN game.entity_relations rel
        ON rel.source_instance_id = i.instance_id AND rel.relation_type = 'installed_in'
      WHERE i.owner_id = ${actorId}
        AND rel.target_instance_id = ${actor.residence_instance_id}
        AND (${requestedMethodId || null}::uuid IS NULL OR i.instance_id = ${requestedMethodId || null})
      ORDER BY i.created_at ASC
      LIMIT 1
    `;
    const method = methods[0];
    if (!method) {
      throw new ActionStoreError(
        "invalid_method",
        "No authorized installed system is available for this action.",
      );
    }

    const targetRows = await database.client`
      SELECT state FROM game.entity_instances WHERE instance_id = ${ALLEY_TARGET.instanceId}
    `;
    const targetState = (targetRows[0]?.state as Record<string, unknown>) || {};
    const environment = { clutter: 1, darkness: 2, coverageSupport: 1 };
    const draft = method.payload as GeneratedDefinitionDraft;
    const publicFacts = [
      "The selected system is installed in the actor's residence.",
      "The rear alley is directly adjacent to the residence.",
      "The rear alley has dim lighting and moderate clutter.",
    ];

    return {
      actor: { id: actorId, name: String(actor.name) },
      residence: {
        id: String(actor.residence_instance_id),
        name: String(actor.residence_name),
      },
      targetLocation: { id: STARTER_WORLD_IDS.alley, name: "Rear Alley", environment },
      method: {
        instanceId: String(method.instance_id),
        definitionId: String(method.definition_id),
        name: String(method.name),
        condition: Number(method.condition),
        state: method.state as Record<string, unknown>,
        draft,
        installed: true,
      },
      publicFacts,
      publicContext: {
        facts: publicFacts,
        actor: { id: actorId, name: String(actor.name) },
        residence: {
          id: String(actor.residence_instance_id),
          name: String(actor.residence_name),
        },
        targetLocation: {
          id: STARTER_WORLD_IDS.alley,
          name: "Rear Alley",
          environment: { lighting: "dim", clutter: "moderate", adjacency: "direct" },
        },
        method: {
          instanceId: String(method.instance_id),
          definitionId: String(method.definition_id),
          name: String(method.name),
          declaredEffects: [...draft.effects, ...draft.modes.flatMap((mode) => mode.effects)],
        },
      },
      hiddenMechanics: {
        targetId: ALLEY_TARGET.instanceId,
        concealment: Number(targetState.concealment || 3),
        countermeasure: Number(targetState.countermeasure || 0),
        hiddenFacts: ["The contact is human.", "The contact is moving east through the alley."],
      },
    };
  }

  async function findByIdempotency(
    userId: string,
    idempotencyKey: string,
  ): Promise<ActionExecutionResponse | null> {
    const rows = await database.client`
      SELECT e.event_id, ai.intent_id, rr.resolution_id, rr.outcome_grade,
             rr.calculation_trace, rr.narration, e.payload
      FROM game.event_ledger e
      JOIN game.action_intents ai ON ai.intent_id = e.source_intent_id
      JOIN game.resolution_results rr ON rr.event_id = e.event_id
      WHERE e.idempotency_key = ${idempotencyKey} AND ai.user_id = ${userId}
    `;
    if (!rows[0]) return null;
    const row = rows[0];
    const payload = row.payload as Record<string, unknown>;
    return {
      eventId: String(row.event_id),
      intentId: String(row.intent_id),
      resolutionId: String(row.resolution_id),
      outcomeGrade: String(row.outcome_grade),
      margin: Number(payload.margin),
      narration: String(row.narration || "The event has been committed."),
      calculationTrace: row.calculation_trace as string[],
      informationGained:
        (payload.informationGained as ActionExecutionResponse["informationGained"]) || [],
      costs: (payload.costs as ActionExecutionResponse["costs"]) || [],
      idempotentReplay: true,
    };
  }

  async function startAiRun(input: {
    task: string;
    authority: string;
    requestedModel: string;
    policyVersion: string;
    inputHash: string;
    metadata: Record<string, unknown>;
  }) {
    const runId = randomUUID();
    await database.client`
      INSERT INTO system.ai_runs (
        run_id, task, authority, requested_model, prompt_policy_version,
        status, input_hash, metadata
      ) VALUES (
        ${runId}, ${input.task}, ${input.authority}, ${input.requestedModel},
        ${input.policyVersion}, 'running', ${input.inputHash},
        ${json(input.metadata)}
      )
    `;
    return runId;
  }

  async function finishAiRun(
    runId: string,
    actualModel: string,
    providerRequestId: string | undefined,
    outputHash: string,
  ) {
    await database.client`
      UPDATE system.ai_runs
      SET actual_model = ${actualModel}, provider_request_id = ${providerRequestId || null},
          output_hash = ${outputHash}, status = 'completed', completed_at = now()
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

  async function commit(input: {
    userId: string;
    idempotencyKey: string;
    rawText: string;
    intent: ActionIntent;
    methodInstanceId: string;
    targetLocationId: string;
    seed: string;
    actorScore: number;
    targetScore: number;
    resolution: ResolutionResult;
    operations: StateOperation[];
  }): Promise<ActionExecutionResponse> {
    const parsedOperations = input.operations.map((operation) =>
      StateOperationSchema.parse(operation),
    );

    return database.client.begin(async (sql) => {
      const existing = await sql`
        SELECT 1 FROM game.event_ledger WHERE idempotency_key = ${input.idempotencyKey}
      `;
      if (existing.length) {
        throw new ActionStoreError(
          "duplicate",
          "The idempotent result was committed concurrently; retry to retrieve it.",
        );
      }

      const intentId = randomUUID();
      const resolutionId = randomUUID();
      const eventId = randomUUID();
      const informationGained: ActionExecutionResponse["informationGained"] = [];
      const costs: ActionExecutionResponse["costs"] = [];

      await sql`
        INSERT INTO game.action_intents (
          intent_id, actor_id, user_id, raw_text, parsed_intent,
          method_instance_id, target_location_id, idempotency_key
        ) VALUES (
          ${intentId}, ${input.intent.actorId}, ${input.userId}, ${input.rawText},
          ${json(input.intent)}, ${input.methodInstanceId}, ${input.targetLocationId},
          ${input.idempotencyKey}
        )
      `;

      for (const operation of parsedOperations) {
        if (operation.type === "create_information_asset") {
          informationGained.push({
            informationId: randomUUID(),
            content: operation.content,
            confidence: operation.confidence,
          });
        }
        if (operation.type === "consume_resource") {
          costs.push({ resource: operation.resource, amount: operation.amount });
        }
      }

      const eventPayload = {
        outcomeGrade: input.resolution.outcomeGrade,
        margin: input.resolution.margin,
        operations: parsedOperations,
        informationGained,
        costs,
      };
      await sql`
        INSERT INTO game.event_ledger (
          event_id, idempotency_key, world_time, event_type,
          involved_entity_ids, payload, source_intent_id
        ) VALUES (
          ${eventId}, ${input.idempotencyKey}, now(), 'action_resolved',
          ${json([input.intent.actorId, input.methodInstanceId, input.targetLocationId])},
          ${json(eventPayload)}, ${intentId}
        )
      `;

      let infoIndex = 0;
      for (const operation of parsedOperations) {
        if (operation.type === "create_information_asset") {
          const information = informationGained[infoIndex++];
          if (!information) throw new Error("Information operation result is missing.");
          const informationId = information.informationId;
          await sql`
            INSERT INTO game.information_assets (
              information_id, holder_instance_id, subject_instance_id,
              content, confidence, truth_status, source_event_id
            ) VALUES (
              ${informationId}, ${operation.holderId}, ${operation.subjectId || null},
              ${operation.content}, ${operation.confidence}, ${operation.truthStatus}, ${eventId}
            )
          `;
        } else if (operation.type === "consume_resource") {
          const path = `{consumedResources,${operation.resource}}`;
          await sql`
            UPDATE game.entity_instances
            SET state = jsonb_set(
                  state,
                  ${path}::text[],
                  to_jsonb(COALESCE((state #>> ${path}::text[])::numeric, 0) + ${operation.amount}),
                  true
                ),
                updated_at = now()
            WHERE instance_id = ${operation.instanceId}
          `;
        } else if (operation.type === "set_instance_state") {
          const path = `{${operation.path.join(",")}}`;
          await sql`
            UPDATE game.entity_instances
            SET state = jsonb_set(state, ${path}::text[], ${json(operation.value)}, true),
                updated_at = now()
            WHERE instance_id = ${operation.instanceId}
          `;
        } else if (operation.type === "change_instance_condition") {
          await sql`
            UPDATE game.entity_instances
            SET condition = GREATEST(0, LEAST(100, condition + ${operation.delta})),
                updated_at = now()
            WHERE instance_id = ${operation.instanceId}
          `;
        }
      }

      await sql`
        INSERT INTO game.resolution_results (
          resolution_id, intent_id, event_id, outcome_grade, calculation_trace,
          proposed_operations, narrative_constraints, authoritative_seed,
          actor_score, target_score
        ) VALUES (
          ${resolutionId}, ${intentId}, ${eventId}, ${input.resolution.outcomeGrade},
          ${json(input.resolution.calculationTrace)}, ${json(parsedOperations)},
          ${json(input.resolution.narrativeConstraints)}, ${input.seed},
          ${input.actorScore}, ${input.targetScore}
        )
      `;

      return {
        eventId,
        intentId,
        resolutionId,
        outcomeGrade: input.resolution.outcomeGrade,
        margin: input.resolution.margin,
        narration: "The event has been committed and awaits narration.",
        calculationTrace: input.resolution.calculationTrace,
        informationGained,
        costs,
        idempotentReplay: false,
      };
    });
  }

  async function saveNarration(resolutionId: string, narration: string) {
    await database.client`
      UPDATE game.resolution_results SET narration = ${narration}
      WHERE resolution_id = ${resolutionId}
    `;
  }

  async function list(userId: string, actorId: string): Promise<ActionExecutionResponse[]> {
    const rows = await database.client`
      SELECT ai.idempotency_key
      FROM game.action_intents ai
      WHERE ai.user_id = ${userId} AND ai.actor_id = ${actorId}
      ORDER BY ai.created_at DESC
      LIMIT 25
    `;
    const results = await Promise.all(
      rows.map((row) => findByIdempotency(userId, String(row.idempotency_key))),
    );
    return results.filter((result): result is ActionExecutionResponse => Boolean(result));
  }

  return {
    getContext,
    findByIdempotency,
    startAiRun,
    finishAiRun,
    failAiRun,
    commit,
    saveNarration,
    list,
  };
}

export type ActionStore = ReturnType<typeof createActionStore>;
