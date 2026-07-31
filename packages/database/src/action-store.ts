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
import { serializeJson as json } from "./json.js";

const ALLEY_TARGET = {
  definitionId: "WORLD-ALLEY-CONTACT",
  revisionId: "60000000-0000-4000-8000-000000000001",
  instanceId: "60000000-0000-4000-8000-000000000002",
};

export interface ActionRuntimeContext {
  actor: { id: string; name: string; state: Record<string, unknown> };
  residence: { id: string; name: string } | null;
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
      SELECT d.name, actor.state, o.residence_instance_id, rd.name AS residence_name
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

    const targetLocationId = requestedTargetId || STARTER_WORLD_IDS.alley;

    // ponytail: method optional. Bare actions use a synthetic body-method.
    const methods = actor.residence_instance_id
      ? await database.client`
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
    `
      : [];
    const methodRow = methods[0] ?? null;

    const bareDraft = {
      name: "Bare hands / senses",
      effects: [{ id: "bare", label: "Unaided action", strength: 2 }],
      modes: [{ id: "default", label: "Default", effects: [] }],
      constraints: [],
    } as unknown as GeneratedDefinitionDraft;

    const method = methodRow
      ? {
          instanceId: String(methodRow.instance_id),
          definitionId: String(methodRow.definition_id),
          name: String(methodRow.name),
          condition: Number(methodRow.condition),
          state: methodRow.state as Record<string, unknown>,
          draft: methodRow.payload as GeneratedDefinitionDraft,
          installed: true,
        }
      : {
          instanceId: actorId,
          definitionId: "BARE-ACTION",
          name: "Bare hands / senses",
          condition: 100,
          state: {},
          draft: bareDraft,
          installed: false,
        };

    const targetRows = await database.client`
      SELECT state FROM game.entity_instances WHERE instance_id = ${ALLEY_TARGET.instanceId}
    `;
    const targetState = (targetRows[0]?.state as Record<string, unknown>) || {};
    const environment = { clutter: 1, darkness: 2, coverageSupport: 1 };
    const publicFacts = [
      "The rear alley is directly adjacent to the residence.",
      "The rear alley has dim lighting and moderate clutter.",
      ...(method.installed ? ["The selected system is installed in the actor's residence."] : []),
    ];

    return {
      actor: {
        id: actorId,
        name: String(actor.name),
        state: (actor.state as Record<string, unknown>) ?? {},
      },
      residence: actor.residence_instance_id
        ? {
            id: String(actor.residence_instance_id),
            name: String(actor.residence_name ?? "Residence"),
          }
        : null,
      targetLocation: { id: STARTER_WORLD_IDS.alley, name: "Rear Alley", environment },
      method,
      publicFacts,
      publicContext: {
        facts: publicFacts,
        actor: { id: actorId, name: String(actor.name) },
        residence: actor.residence_instance_id
          ? {
              id: String(actor.residence_instance_id),
              name: String(actor.residence_name ?? "Residence"),
            }
          : null,
        targetLocation: {
          id: STARTER_WORLD_IDS.alley,
          name: "Rear Alley",
          environment: { lighting: "dim", clutter: "moderate", adjacency: "direct" },
        },
        method: {
          instanceId: method.instanceId,
          definitionId: method.definitionId,
          name: method.name,
          installed: method.installed,
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
      SELECT e.event_id, e.world_time, ai.intent_id, ai.raw_text, rr.resolution_id,
             rr.outcome_grade, rr.calculation_trace, rr.narration, e.payload
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
      rawText: String(row.raw_text),
      outcomeGrade: String(row.outcome_grade),
      margin: Number(payload.margin),
      narration: String(row.narration || "The event has been committed."),
      calculationTrace: row.calculation_trace as string[],
      informationGained:
        (payload.informationGained as ActionExecutionResponse["informationGained"]) || [],
      costs: (payload.costs as ActionExecutionResponse["costs"]) || [],
      createdAt: new Date(row.world_time as Date).toISOString(),
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
    const createdAt = new Date().toISOString();

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
          ${eventId}, ${input.idempotencyKey}, ${createdAt}, 'action_resolved',
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
        rawText: input.rawText,
        outcomeGrade: input.resolution.outcomeGrade,
        margin: input.resolution.margin,
        narration: "The event has been committed and awaits narration.",
        calculationTrace: input.resolution.calculationTrace,
        informationGained,
        costs,
        createdAt,
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

  async function applyActorSkillXp(
    actorId: string,
    skill: string,
    xpGain: number,
  ): Promise<{ xp: number; level: number; leveledUp: boolean } | null> {
    const rows = await database.client`
      SELECT state FROM game.entity_instances WHERE instance_id = ${actorId}
    `;
    if (!rows[0]) return null;
    const state = { ...((rows[0].state as Record<string, unknown>) || {}) };
    const skills = { ...((state.skills as Record<string, number>) || {}) };
    const oldXp = skills[skill] ?? 0;
    const oldLevel = Math.floor(Math.sqrt(oldXp / 10));
    const newXp = oldXp + xpGain;
    const newLevel = Math.min(100, Math.floor(Math.sqrt(newXp / 10)));
    skills[skill] = newXp;
    state.skills = skills;
    await database.client`
      UPDATE game.entity_instances SET state = ${json(state)}, updated_at = now()
      WHERE instance_id = ${actorId}
    `;
    return { xp: newXp, level: newLevel, leveledUp: newLevel > oldLevel };
  }

  /** Death: strip items owned by actor that are located_at actor (carried/equipped). */
  async function stripCarriedOnDeath(actorId: string): Promise<number> {
    const dropped = await database.client`
      UPDATE game.entity_instances i
      SET owner_id = NULL,
          location_id = (SELECT location_id FROM game.entity_instances WHERE instance_id = ${actorId}),
          state = coalesce(state, '{}'::jsonb) || '{"dropped":true}'::jsonb,
          updated_at = now()
      WHERE i.owner_id = ${actorId}
        AND i.instance_id <> ${actorId}
        AND (
          i.location_id = ${actorId}
          OR i.location_id = (SELECT location_id FROM game.entity_instances WHERE instance_id = ${actorId})
          OR EXISTS (
            SELECT 1 FROM game.entity_relations r
            WHERE r.source_instance_id = i.instance_id
              AND r.target_instance_id = ${actorId}
              AND r.relation_type IN ('equipped_by', 'carried_by', 'located_at')
          )
        )
      RETURNING instance_id
    `;
    await database.client`
      UPDATE game.entity_instances
      SET state = coalesce(state, '{}'::jsonb)
            || '{"status":"dead","pendingDeath":false,"cashOnPerson":0}'::jsonb,
          condition = 0,
          updated_at = now()
      WHERE instance_id = ${actorId}
    `;
    return dropped.length;
  }

  async function findNearbyNpc(
    actorId: string,
  ): Promise<{ instanceId: string; name: string; schedule?: Record<string, string> } | null> {
    // ponytail: any NPC; co-location match later.
    const any = await database.client`
      SELECT npc.instance_id, d.name, npc.state
      FROM game.entity_instances npc
      JOIN game.entity_definitions d ON d.definition_id = npc.definition_id
      WHERE d.definition_type = 'npc'
        AND npc.instance_id <> ${actorId}
      LIMIT 1
    `;
    if (!any[0]) return null;
    const st = (any[0].state as Record<string, unknown>) || {};
    return {
      instanceId: String(any[0].instance_id),
      name: String(any[0].name),
      schedule: st.schedule as Record<string, string> | undefined,
    };
  }

  async function scheduleJob(input: {
    kind: string;
    resolvesAt: Date;
    payload: Record<string, unknown>;
    intentId?: string | null;
  }): Promise<string> {
    const id = randomUUID();
    await database.client`
      INSERT INTO game.scheduled_actions (schedule_id, intent_id, resolves_at, status, kind, payload)
      VALUES (
        ${id}, ${input.intentId || null}, ${input.resolvesAt.toISOString()},
        'pending', ${input.kind}, ${json(input.payload)}
      )
    `;
    return id;
  }

  async function moveActor(actorId: string, locationId: string): Promise<boolean> {
    const rows = await database.client`
      UPDATE game.entity_instances
      SET location_id = ${locationId}, updated_at = now()
      WHERE instance_id = ${actorId}
      RETURNING instance_id
    `;
    return rows.length === 1;
  }

  async function getActorLocation(actorId: string): Promise<string | null> {
    const rows = await database.client`
      SELECT location_id FROM game.entity_instances WHERE instance_id = ${actorId}
    `;
    return rows[0]?.location_id ? String(rows[0].location_id) : null;
  }

  async function getOwnedVehicleSpeed(ownerId: string): Promise<number> {
    const rows = await database.client`
      SELECT state FROM game.entity_instances
      WHERE definition_id = 'vehicle' AND owner_id = ${ownerId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    if (!rows[0]) return 1;
    const st = (rows[0].state as Record<string, unknown>) || {};
    return Math.max(0.1, Number(st.speedFactor || 1));
  }

  async function patchActorState(
    actorId: string,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const rows = await database.client`
      SELECT state FROM game.entity_instances WHERE instance_id = ${actorId}
    `;
    const state = { ...((rows[0]?.state as Record<string, unknown>) || {}), ...patch };
    await database.client`
      UPDATE game.entity_instances SET state = ${json(state)}, updated_at = now()
      WHERE instance_id = ${actorId}
    `;
    return state;
  }

  async function readActorState(actorId: string): Promise<Record<string, unknown>> {
    const rows = await database.client`
      SELECT state FROM game.entity_instances WHERE instance_id = ${actorId}
    `;
    return { ...((rows[0]?.state as Record<string, unknown>) || {}) };
  }

  async function sendComms(input: {
    fromId: string;
    toId?: string | null;
    toName: string;
    body: string;
    intercepted: boolean;
    chance: number;
  }) {
    const id = randomUUID();
    await database.client`
      INSERT INTO game.comms_messages (
        message_id, from_id, to_id, to_name, body, intercepted, intercept_chance
      ) VALUES (
        ${id}, ${input.fromId}, ${input.toId || null}, ${input.toName},
        ${input.body}, ${input.intercepted}, ${input.chance}
      )
    `;
    return { messageId: id, ...input };
  }

  async function listComms(fromId: string) {
    const rows = await database.client`
      SELECT message_id, from_id, to_id, to_name, body, intercepted, intercept_chance, created_at
      FROM game.comms_messages
      WHERE from_id = ${fromId}
      ORDER BY created_at DESC
      LIMIT 50
    `;
    return rows.map((r) => ({
      messageId: String(r.message_id),
      fromId: String(r.from_id),
      toId: r.to_id ? String(r.to_id) : null,
      toName: String(r.to_name),
      body: String(r.body),
      intercepted: Boolean(r.intercepted),
      interceptChance: Number(r.intercept_chance),
      createdAt: new Date(r.created_at as Date).toISOString(),
    }));
  }

  async function resolvePlaceByName(
    nameHint: string,
  ): Promise<{ id: string; name: string } | null> {
    const q = `%${nameHint.toLowerCase()}%`;
    const rows = await database.client`
      SELECT i.instance_id, d.name
      FROM game.entity_instances i
      JOIN game.entity_definitions d ON d.definition_id = i.definition_id
      WHERE d.definition_type IN ('location', 'residence', 'place')
        AND lower(d.name) LIKE ${q}
      LIMIT 1
    `;
    if (!rows[0]) {
      // fallback rear alley
      const alley = await database.client`
        SELECT i.instance_id, d.name FROM game.entity_instances i
        JOIN game.entity_definitions d ON d.definition_id = i.definition_id
        WHERE i.instance_id = '10000000-0000-4000-8000-000000000006'
        LIMIT 1
      `;
      if (!alley[0]) return null;
      return { id: String(alley[0].instance_id), name: String(alley[0].name) };
    }
    return { id: String(rows[0].instance_id), name: String(rows[0].name) };
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
    applyActorSkillXp,
    stripCarriedOnDeath,
    findNearbyNpc,
    scheduleJob,
    moveActor,
    getActorLocation,
    getOwnedVehicleSpeed,
    patchActorState,
    readActorState,
    sendComms,
    listComms,
    resolvePlaceByName,
  };
}

export type ActionStore = ReturnType<typeof createActionStore>;
