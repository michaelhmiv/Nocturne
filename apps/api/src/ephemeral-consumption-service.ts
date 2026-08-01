import { createHmac, randomUUID } from "node:crypto";
import {
  analyzeEphemeralConsumption,
  narrateCommittedEvent,
  type AiProviderClient,
} from "@nocturne/ai-gm";
import {
  EphemeralConsumptionAnalysisRequestSchema,
  type EphemeralConsumptionAnalysis,
} from "@nocturne/contracts";
import type { createDatabase, WorldScope } from "@nocturne/database";

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

const json = (value: unknown) => JSON.stringify(value);

function riskOccurs(secret: string | Buffer, idempotencyKey: string, basisPoints: number) {
  if (basisPoints <= 0) return false;
  const digest = createHmac("sha256", secret)
    .update(`${idempotencyKey}:ephemeral-contamination`)
    .digest();
  return digest.readUInt32BE(0) % 10_000 < basisPoints;
}

function outcomeFor(analysis: EphemeralConsumptionAnalysis, contaminationOccurred: boolean) {
  if (!analysis.consumable || analysis.plausibility === "implausible") return "no_effect";
  if (contaminationOccurred || analysis.conditions.some((condition) => condition.intensity < 0)) {
    return "success_with_consequence";
  }
  return "complete_success";
}

export function createEphemeralConsumptionService(dependencies: {
  database: ReturnType<typeof createDatabase>;
  client: AiProviderClient;
  rollSecret: string | Buffer;
  listRecentPlayerSafeText(input: { scope: WorldScope; limit: number }): Promise<string[]>;
}) {
  return async function execute(input: {
    scope: WorldScope;
    actorId: string;
    rawText: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  }) {
    if (input.payload.sourceMode !== "ephemeral_environment") {
      throw new Error("Ephemeral consumption requires sourceMode=ephemeral_environment.");
    }
    const concept =
      typeof input.payload.ephemeralConcept === "string"
        ? input.payload.ephemeralConcept.trim()
        : "";
    const sourceDescription =
      typeof input.payload.sourceDescription === "string"
        ? input.payload.sourceDescription.trim()
        : "";
    if (!concept || !sourceDescription) {
      throw new Error("Ephemeral consumption requires a concept and incidental source description.");
    }

    const actorRows = await dependencies.database.client<
      {
        location_id: string | null;
        state: Record<string, unknown>;
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
      WHERE character.world_id = ${input.scope.worldId}
        AND character.user_id = ${input.scope.userId}
        AND character.character_instance_id = ${input.actorId}
        AND actor.shard_id = ${input.scope.shardId}
      LIMIT 1
    `;
    const actor = actorRows[0];
    if (!actor) throw new Error("The selected actor is not available in this world.");

    const recentTurns = await dependencies.listRecentPlayerSafeText({
      scope: input.scope,
      limit: 10,
    });
    const analysisInput = EphemeralConsumptionAnalysisRequestSchema.parse({
      actorId: input.actorId,
      rawText: input.rawText,
      locationName: actor.location_name || "Current scene",
      locationDescription: actor.location_description || "",
      concept,
      sourceDescription,
      recentTurns,
    });
    const analyzed = await analyzeEphemeralConsumption(dependencies.client, analysisInput);
    const analysis = analyzed.data;
    const contaminationOccurred = riskOccurs(
      dependencies.rollSecret,
      input.idempotencyKey,
      analysis.contaminationRiskBasisPoints,
    );
    const appliedDeltas = [
      ...analysis.resourceDeltas,
      ...(contaminationOccurred ? analysis.contaminationEffects : []),
    ];
    const outcomeGrade = outcomeFor(analysis, contaminationOccurred);
    const eventId = randomUUID();
    const intentId = randomUUID();
    const resolutionId = randomUUID();
    const createdAt = new Date().toISOString();

    await dependencies.database.client.begin(async (sql) => {
      const existing = await sql<{ event_id: string }[]>`
        SELECT event_id
        FROM game.event_ledger
        WHERE idempotency_key = ${input.idempotencyKey}
        LIMIT 1
      `;
      if (existing[0]) return;

      const lockedActors = await sql<
        { state: Record<string, unknown>; condition: number; location_id: string | null }[]
      >`
        SELECT state, condition, location_id
        FROM game.entity_instances
        WHERE world_id = ${input.scope.worldId}
          AND shard_id = ${input.scope.shardId}
          AND instance_id = ${input.actorId}
        FOR UPDATE
      `;
      const lockedActor = lockedActors[0];
      if (!lockedActor) throw new Error("The actor disappeared before consumption committed.");

      let actorState = object(lockedActor.state);
      let condition = numeric(lockedActor.condition, 100);
      const resources = { ...object(actorState.resources) };
      for (const delta of appliedDeltas) {
        if (delta.resource === "condition") {
          condition = clamp(condition + delta.delta, 0, 100);
        } else if (delta.delta !== 0) {
          resources[delta.resource] = clamp(
            numeric(resources[delta.resource], 0) + delta.delta,
            -100,
            100,
          );
        }
      }
      actorState = { ...actorState, resources };
      const activeConditions = { ...object(actorState.activeConditions) };
      for (const effect of analysis.conditions) {
        activeConditions[effect.key] = {
          name: effect.name,
          intensity: effect.intensity,
          expiresAt: new Date(Date.now() + effect.durationSeconds * 1_000).toISOString(),
          rationale: effect.rationale,
          sourceEventId: eventId,
        };
      }
      actorState.activeConditions = activeConditions;

      await sql`
        UPDATE game.entity_instances
        SET state = ${json(actorState)}::jsonb,
            condition = ${condition},
            updated_at = now()
        WHERE world_id = ${input.scope.worldId}
          AND shard_id = ${input.scope.shardId}
          AND instance_id = ${input.actorId}
      `;

      const intent = {
        actorId: input.actorId,
        rawText: input.rawText,
        actionType: "consume",
        targetIds: [],
        methodDefinitionIds: [],
        objective: input.rawText.slice(0, 500),
        intensity: "normal",
        assumptions: [
          "The substance and incidental source are low-value ephemeral environmental affordances.",
        ],
        confidence: 1,
      };
      await sql`
        INSERT INTO game.action_intents (
          intent_id, actor_id, user_id, raw_text, parsed_intent,
          method_instance_id, target_location_id, idempotency_key
        ) VALUES (
          ${intentId}, ${input.actorId}, ${input.scope.userId}, ${input.rawText},
          ${json(intent)}::jsonb, ${input.actorId}, ${lockedActor.location_id},
          ${input.idempotencyKey}
        )
      `;

      const eventPayload = {
        outcomeGrade,
        margin: outcomeGrade === "no_effect" ? 0 : 1,
        operations: [],
        informationGained: [],
        costs: [],
        ephemeralConsumption: {
          sourceMode: "ephemeral_environment",
          concept,
          sourceDescription,
          persistenceRequired: false,
          unitsConsumed: analysis.consumable ? 1 : 0,
          analysis,
          contamination: {
            chanceBasisPoints: analysis.contaminationRiskBasisPoints,
            occurred: contaminationOccurred,
          },
          appliedResourceDeltas: appliedDeltas,
          appliedConditions: analysis.conditions,
        },
      };
      await sql`
        INSERT INTO game.event_ledger (
          event_id, idempotency_key, world_time, event_type,
          involved_entity_ids, payload, source_intent_id
        ) VALUES (
          ${eventId}, ${input.idempotencyKey}, ${createdAt},
          'ephemeral_consumption_resolved', ${json([input.actorId])}::jsonb,
          ${json(eventPayload)}::jsonb, ${intentId}
        )
      `;

      await sql`
        INSERT INTO game.resolution_results (
          resolution_id, intent_id, event_id, outcome_grade, calculation_trace,
          proposed_operations, narrative_constraints, authoritative_seed,
          actor_score, target_score
        ) VALUES (
          ${resolutionId}, ${intentId}, ${eventId}, ${outcomeGrade},
          ${json([
            `ephemeral_concept=${concept}`,
            `nutrition=${analysis.nutritionValue}`,
            `hydration=${analysis.hydrationValue}`,
            `contamination_roll=${contaminationOccurred ? "occurred" : "did_not_occur"}`,
          ])}::jsonb,
          '[]'::jsonb,
          ${json([
            "The incidental object is not durable inventory.",
            "Do not imply nutrition, hydration, injury, or contamination beyond committed facts.",
            "Treat the action as valid roleplay even when it has no mechanical benefit.",
          ])}::jsonb,
          ${input.idempotencyKey}, 0, 0
        )
      `;
    });

    let narration = analysis.consumable
      ? `You consume ${analysis.displayName}. It provides no meaningful benefit.`
      : `You try, but ${analysis.displayName} cannot be consumed as intended.`;
    try {
      const narrated = await narrateCommittedEvent(dependencies.client, {
        eventId,
        intentId,
        resolutionId,
        rawText: input.rawText,
        outcomeGrade,
        margin: outcomeGrade === "no_effect" ? 0 : 1,
        calculationTrace: [],
        informationGained: [],
        costs: [],
        createdAt,
        factsToPreserve: [
          `action:consume`,
          `substance:${analysis.displayName}`,
          `source:${sourceDescription}`,
          `persistence:ephemeral`,
          `nutrition:${analysis.nutritionValue}`,
          `hydration:${analysis.hydrationValue}`,
          `contamination:${contaminationOccurred ? "occurred" : "did_not_occur"}`,
          ...analysis.narrationFacts,
          ...appliedDeltas.map((delta) => `${delta.resource}:${delta.delta}:${delta.rationale}`),
          ...analysis.conditions.map(
            (conditionEffect) =>
              `${conditionEffect.name}:${conditionEffect.intensity}:${conditionEffect.durationSeconds}:${conditionEffect.rationale}`,
          ),
        ],
        hiddenFactsToExclude: [],
      });
      narration = narrated.data.narration;
    } catch {
      // The authoritative event is already committed; deterministic narration remains safe.
    }

    return { eventId, outcomeGrade, narration };
  };
}
