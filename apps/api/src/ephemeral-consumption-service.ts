import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  analyzeEphemeralConsumptionResilient,
  detectedAdvantageCategories,
  deterministicEphemeralNarration,
  narrateEphemeralConsumption,
  type AiProviderClient,
} from "@nocturne/ai-gm";
import {
  ActionExecutionResponseSchema,
  ActionIntentSchema,
  ConsumptionAnalysisRequestSchema,
  ConsumptionResultSchema,
  type ActionExecutionResponse,
  type ConsumableAnalysis,
  type ConsumptionMechanicsResult,
} from "@nocturne/contracts";
import {
  serializeJson as json,
  type WorldScope,
  type createDatabase,
} from "@nocturne/database";
import { resolveConsumptionMechanics } from "@nocturne/rules-engine";

export class EphemeralConsumptionError extends Error {
  constructor(
    readonly code:
      | "invalid_ephemeral_payload"
      | "ephemeral_advantage_blocked"
      | "actor_unavailable"
      | "duplicate",
    message: string,
  ) {
    super(message);
    this.name = "EphemeralConsumptionError";
  }
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const numeric = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, value));

function deterministicUuid(value: string) {
  const hexadecimal = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hexadecimal[12] = "4";
  hexadecimal[16] = "8";
  const compact = hexadecimal.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

type EnvironmentalAffordance = {
  concept: string;
  role: string;
  status: "plausible_ephemeral" | "scene_local";
};

function parseAffordances(payload: Record<string, unknown>) {
  if (payload.sourceMode !== "ephemeral_environmental") {
    throw new EphemeralConsumptionError(
      "invalid_ephemeral_payload",
      "Ephemeral consumption requires sourceMode=ephemeral_environmental.",
    );
  }
  const raw = Array.isArray(payload.environmentalAffordances)
    ? payload.environmentalAffordances
    : [];
  const affordances = raw
    .map((value) => object(value))
    .filter(
      (value) =>
        typeof value.concept === "string" &&
        typeof value.role === "string" &&
        ["plausible_ephemeral", "scene_local"].includes(String(value.status)),
    )
    .map(
      (value): EnvironmentalAffordance => ({
        concept: String(value.concept).trim().slice(0, 500),
        role: String(value.role).trim().slice(0, 100),
        status: value.status as EnvironmentalAffordance["status"],
      }),
    )
    .filter(({ concept }) => concept.length > 0)
    .slice(0, 16);
  if (!affordances.length) {
    throw new EphemeralConsumptionError(
      "invalid_ephemeral_payload",
      "Ephemeral consumption requires at least one authorized environmental affordance.",
    );
  }
  return affordances;
}

function displayConcept(payload: Record<string, unknown>, affordances: EnvironmentalAffordance[]) {
  const requestedConcept = payload.requestedConcept;
  if (typeof requestedConcept === "string" && requestedConcept.trim()) {
    return requestedConcept.trim().slice(0, 180);
  }
  return (
    affordances.find(({ role }) => role === "object" || role === "subject")?.concept ||
    affordances[0]!.concept
  ).slice(0, 180);
}

function mechanicsSeed(secret: string | Buffer, idempotencyKey: string, actorId: string) {
  return createHmac("sha256", secret)
    .update(`${idempotencyKey}:${actorId}:ephemeral-consumption`)
    .digest("hex");
}

function applyActorEffects(input: {
  state: Record<string, unknown>;
  condition: number;
  mechanics: ConsumptionMechanicsResult;
  eventId: string;
}) {
  let condition = input.condition;
  const resources = { ...object(input.state.resources) };
  for (const effect of input.mechanics.resourceDeltas) {
    if (effect.resource === "condition") {
      condition = clamp(condition + effect.delta, 0, 100);
    } else {
      resources[effect.resource] = clamp(
        numeric(resources[effect.resource], 0) + effect.delta,
        -100,
        100,
      );
    }
  }
  const activeConditions = { ...object(input.state.activeConditions) };
  for (const effect of input.mechanics.conditions) {
    activeConditions[effect.key] = {
      name: effect.name,
      intensity: effect.intensity,
      expiresAt: new Date(Date.now() + effect.durationSeconds * 1000).toISOString(),
      rationale: effect.rationale,
      sourceEventId: input.eventId,
    };
  }
  return {
    state: { ...input.state, resources, activeConditions },
    condition,
  };
}

export function createEphemeralConsumptionService(dependencies: {
  database: ReturnType<typeof createDatabase>;
  client: Pick<AiProviderClient, "generateStructured">;
  rollSecret: string | Buffer;
  logger?: {
    info(input: Record<string, unknown>, message?: string): void;
    warn(input: Record<string, unknown>, message?: string): void;
  };
}) {
  async function replay(idempotencyKey: string) {
    const rows = await dependencies.database.client<
      {
        event_id: string;
        outcome_grade: string;
        narration: string | null;
        payload: Record<string, unknown>;
      }[]
    >`
      SELECT event.event_id, resolution.outcome_grade, resolution.narration, event.payload
      FROM game.event_ledger event
      JOIN game.resolution_results resolution ON resolution.event_id = event.event_id
      WHERE event.idempotency_key = ${idempotencyKey}
      LIMIT 1
    `;
    const existing = rows[0];
    if (!existing) return null;
    const consumption = object(existing.payload).consumption;
    return {
      state: "completed" as const,
      outcomeGrade: existing.outcome_grade,
      eventId: existing.event_id,
      narration:
        existing.narration ||
        deterministicEphemeralNarration({
          rawText: "Repeat the prior action.",
          displayName: String(object(consumption).displayName || "the ephemeral substance"),
          risks: Array.isArray(object(consumption).risks)
            ? (object(consumption).risks as Array<{ description: string; occurred: boolean }>)
            : [],
        }),
    };
  }

  async function execute(input: {
    scope: WorldScope;
    actorId: string;
    rawText: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  }) {
    const existing = await replay(input.idempotencyKey);
    if (existing) return existing;

    const affordances = parseAffordances(input.payload);
    const displayName = displayConcept(input.payload, affordances);
    const advantages = detectedAdvantageCategories(
      `${input.rawText} ${displayName} ${affordances.map(({ concept }) => concept).join(" ")}`,
    );
    if (advantages.length) {
      throw new EphemeralConsumptionError(
        "ephemeral_advantage_blocked",
        `Advantage-bearing premises require durable authority: ${advantages.join(", ")}.`,
      );
    }

    const actorRows = await dependencies.database.client<
      {
        location_id: string | null;
        state: Record<string, unknown> | null;
        condition: number;
        location_name: string | null;
        location_description: string | null;
      }[]
    >`
      SELECT actor.location_id, actor.state, actor.condition,
             location_definition.name AS location_name,
             location_definition.concept_summary AS location_description
      FROM game.player_characters character
      JOIN game.entity_instances actor
        ON actor.instance_id = character.character_instance_id
       AND actor.world_id = character.world_id
      LEFT JOIN game.entity_instances location
        ON location.instance_id = actor.location_id
       AND location.world_id = actor.world_id
       AND location.shard_id = actor.shard_id
      LEFT JOIN game.entity_definitions location_definition
        ON location_definition.definition_id = location.definition_id
      WHERE character.user_id = ${input.scope.userId}
        AND character.character_instance_id = ${input.actorId}
        AND actor.world_id = ${input.scope.worldId}
        AND actor.shard_id = ${input.scope.shardId}
      LIMIT 1
    `;
    const actor = actorRows[0];
    if (!actor) {
      throw new EphemeralConsumptionError(
        "actor_unavailable",
        "The controlled actor is unavailable in the active world.",
      );
    }

    const sourceId = deterministicUuid(
      `${input.scope.worldId}:${input.scope.shardId}:${input.idempotencyKey}:${displayName}`,
    );
    const analysisRequest = ConsumptionAnalysisRequestSchema.parse({
      actorId: input.actorId,
      rawText: input.rawText,
      locationName: actor.location_name || "Unknown location",
      locationDescription: actor.location_description || "",
      actorState: object(actor.state),
      candidates: [
        {
          sourceType: "ephemeral_environment",
          sourceId,
          name: displayName,
          description: `A request-scoped mundane environmental affordance at ${actor.location_name || "the current location"}: ${affordances
            .map(({ concept, role }) => `${role}=${concept}`)
            .join(", ")}.`,
          access: "ambient",
          quantity: 1,
          state: {
            ephemeral: true,
            persistenceRequired: false,
            authorizedAffordances: affordances,
          },
          constraints: [
            "exists only for this immediate action",
            "must not enter inventory",
            "must not create durable scenery or an entity instance",
            "must not grant meaningful resources or advantages",
          ],
        },
      ],
    });

    const analyzed = await analyzeEphemeralConsumptionResilient(
      dependencies.client,
      analysisRequest,
    );
    const analysis: ConsumableAnalysis = analyzed.analysis;
    const mechanics = resolveConsumptionMechanics(
      analysis,
      mechanicsSeed(dependencies.rollSecret, input.idempotencyKey, input.actorId),
    );
    const createdAt = new Date().toISOString();
    const intentId = randomUUID();
    const resolutionId = randomUUID();
    const eventId = randomUUID();
    const intent = ActionIntentSchema.parse({
      actorId: input.actorId,
      rawText: input.rawText,
      actionType: "consume",
      targetIds: [],
      methodDefinitionIds: [],
      objective: `Consume ${displayName}`,
      intensity: "normal",
      assumptions: [
        "The environmental detail was provisionally authorized for this immediate action only.",
      ],
      confidence: analysis.selection.confidence,
    });
    const consumption = ConsumptionResultSchema.parse({
      sourceType: "ephemeral_environment",
      sourceId,
      displayName: analysis.selection.displayName,
      unitsConsumed: analysis.classification.consumable ? analysis.consumeUnits : 0,
      remainingUnits: null,
      materialized: false,
      resourceDeltas: mechanics.resourceDeltas,
      conditions: mechanics.conditions,
      risks: mechanics.risks,
    });
    const committed = await dependencies.database.client.begin(async (sql) => {
      const duplicate = await sql`
        SELECT event_id FROM game.event_ledger WHERE idempotency_key = ${input.idempotencyKey}
      `;
      if (duplicate.length) {
        throw new EphemeralConsumptionError(
          "duplicate",
          "The ephemeral consumption result was committed concurrently.",
        );
      }
      const lockedRows = await sql<
        { state: Record<string, unknown> | null; condition: number; location_id: string | null }[]
      >`
        SELECT state, condition, location_id
        FROM game.entity_instances
        WHERE world_id = ${input.scope.worldId}
          AND shard_id = ${input.scope.shardId}
          AND instance_id = ${input.actorId}
        FOR UPDATE
      `;
      const lockedActor = lockedRows[0];
      if (!lockedActor) {
        throw new EphemeralConsumptionError(
          "actor_unavailable",
          "The actor disappeared before the action could commit.",
        );
      }
      const applied = applyActorEffects({
        state: object(lockedActor.state),
        condition: numeric(lockedActor.condition, 100),
        mechanics,
        eventId,
      });
      await sql`
        UPDATE game.entity_instances
        SET state = ${json(applied.state)}, condition = ${applied.condition}, updated_at = now()
        WHERE world_id = ${input.scope.worldId}
          AND shard_id = ${input.scope.shardId}
          AND instance_id = ${input.actorId}
      `;
      await sql`
        INSERT INTO game.action_intents (
          intent_id, actor_id, user_id, raw_text, parsed_intent,
          method_instance_id, target_location_id, idempotency_key
        ) VALUES (
          ${intentId}, ${input.actorId}, ${input.scope.userId}, ${input.rawText},
          ${json(intent)}, ${input.actorId}, ${lockedActor.location_id}, ${input.idempotencyKey}
        )
      `;
      const eventPayload = {
        outcomeGrade: mechanics.outcomeGrade,
        margin: mechanics.outcomeGrade === "failure" ? -1 : 1,
        operations: [],
        informationGained: [],
        costs: [{ resource: "ephemeral_units", amount: consumption.unitsConsumed }],
        consumption,
        consumableAnalysis: analysis,
        environmentalAffordances: affordances,
        analysisSource: analyzed.source,
        providerError: analyzed.providerError || null,
        persistence: {
          entityCreated: false,
          inventoryChanged: false,
          ambientPoolChanged: false,
          sceneDetailCreated: false,
        },
      };
      await sql`
        INSERT INTO game.event_ledger (
          event_id, idempotency_key, world_time, event_type,
          involved_entity_ids, payload, source_intent_id
        ) VALUES (
          ${eventId}, ${input.idempotencyKey}, ${createdAt}, 'ephemeral_consumption_resolved',
          ${json([input.actorId])}, ${json(eventPayload)}, ${intentId}
        )
      `;
      await sql`
        INSERT INTO game.resolution_results (
          resolution_id, intent_id, event_id, outcome_grade, calculation_trace,
          proposed_operations, narrative_constraints, authoritative_seed,
          actor_score, target_score
        ) VALUES (
          ${resolutionId}, ${intentId}, ${eventId}, ${mechanics.outcomeGrade},
          ${json([
            ...mechanics.calculationTrace,
            `ephemeral_source_id=${sourceId}`,
            "ephemeral_entity_created=false",
            `ephemeral_analysis_source=${analyzed.source}`,
          ])},
          '[]'::jsonb,
          ${json([
            "Use the human-readable substance name.",
            "The environmental detail did not become inventory or durable scenery.",
            "Do not imply nutrition, hydration, healing, or other benefits beyond committed deltas.",
            "Do not add risk outcomes that were not committed.",
          ])},
          ${mechanicsSeed(dependencies.rollSecret, input.idempotencyKey, input.actorId)},
          0, 0
        )
      `;
      return ActionExecutionResponseSchema.parse({
        eventId,
        intentId,
        resolutionId,
        rawText: input.rawText,
        outcomeGrade: mechanics.outcomeGrade,
        margin: mechanics.outcomeGrade === "failure" ? -1 : 1,
        narration: "The ephemeral consumption event has been committed and awaits narration.",
        calculationTrace: mechanics.calculationTrace,
        informationGained: [],
        costs: eventPayload.costs,
        consumption,
        createdAt,
        idempotentReplay: false,
      });
    });

    let narration = deterministicEphemeralNarration({
      rawText: input.rawText,
      displayName: consumption.displayName,
      risks: consumption.risks,
    });
    try {
      const narrated = await narrateEphemeralConsumption(dependencies.client, {
        committed,
        displayName: consumption.displayName,
        substanceKind: analysis.classification.substanceKind,
        freshnessAssessment: analysis.classification.freshnessAssessment,
        narrationFacts: analysis.narrationFacts,
      });
      narration = narrated.data.narration;
    } catch (error) {
      dependencies.logger?.warn(
        {
          eventId,
          error: error instanceof Error ? error.message : String(error),
        },
        "ephemeral_consumption_narration_fallback",
      );
    }
    await dependencies.database.client`
      UPDATE game.resolution_results
      SET narration = ${narration}
      WHERE resolution_id = ${resolutionId}
    `;
    dependencies.logger?.info(
      {
        eventId,
        actorId: input.actorId,
        sourceId,
        displayName: consumption.displayName,
        unitsConsumed: consumption.unitsConsumed,
        outcomeGrade: mechanics.outcomeGrade,
        analysisSource: analyzed.source,
        persistentEntityCreated: false,
        ambientPoolChanged: false,
      },
      "ephemeral_consumption_resolved",
    );
    return {
      state: "completed" as const,
      outcomeGrade: mechanics.outcomeGrade,
      eventId,
      narration,
    };
  }

  return { execute };
}

export type EphemeralConsumptionService = ReturnType<typeof createEphemeralConsumptionService>;
