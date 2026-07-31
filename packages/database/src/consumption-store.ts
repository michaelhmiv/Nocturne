import { randomUUID } from "node:crypto";
import type {
  ActionExecutionResponse,
  ActionIntent,
  ConsumableAnalysis,
  ConsumptionAnalysisRequest,
  ConsumptionCandidate,
  ConsumptionResult,
} from "@nocturne/contracts";
type ConsumptionMechanicsResult = {
  outcomeGrade:
    | "complete_success"
    | "success_with_consequence"
    | "partial_success"
    | "failure_with_progress"
    | "failure"
    | "catastrophic_reversal";
  resourceDeltas: Array<{ resource: string; delta: number; rationale: string }>;
  conditions: Array<{
    name: string;
    key: string;
    intensity: number;
    durationSeconds: number;
    rationale: string;
  }>;
  risks: Array<{ description: string; occurred: boolean }>;
  calculationTrace: string[];
};
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";

export class ConsumptionStoreError extends Error {
  constructor(
    readonly code: "not_found" | "forbidden" | "unavailable" | "invalid_analysis" | "duplicate",
    message: string,
  ) {
    super(message);
    this.name = "ConsumptionStoreError";
  }
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const arrayOfStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];

const numeric = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

function availableQuantity(state: Record<string, unknown>): number {
  if (state.depleted === true) return 0;
  for (const key of ["quantity", "portionsRemaining", "units", "charges"]) {
    if (key in state) return Math.max(0, numeric(state[key], 0));
  }
  return 1;
}

function applyQuantity(state: Record<string, unknown>, remaining: number) {
  return {
    ...state,
    quantity: remaining,
    depleted: remaining <= 0,
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function createConsumptionStore(database: ReturnType<typeof createDatabase>) {
  async function buildAnalysisRequest(input: {
    userId: string;
    actorId: string;
    rawText: string;
  }): Promise<ConsumptionAnalysisRequest> {
    const actorRows = await database.client`
      SELECT actor.instance_id, actor.location_id, actor.state,
             definition.name, definition.concept_summary,
             location_definition.name AS location_name,
             location_definition.concept_summary AS location_description,
             occupancy.residence_instance_id
      FROM game.player_characters pc
      JOIN game.entity_instances actor ON actor.instance_id = pc.character_instance_id
      JOIN game.entity_definitions definition ON definition.definition_id = actor.definition_id
      LEFT JOIN game.entity_instances location ON location.instance_id = actor.location_id
      LEFT JOIN game.entity_definitions location_definition
        ON location_definition.definition_id = location.definition_id
      LEFT JOIN game.residence_occupancies occupancy
        ON occupancy.character_instance_id = actor.instance_id AND occupancy.status = 'active'
      WHERE pc.user_id = ${input.userId}
        AND pc.character_instance_id = ${input.actorId}
    `;
    const actor = actorRows[0];
    if (!actor) {
      throw new ConsumptionStoreError("forbidden", "Character is not controlled by this account.");
    }

    const actorState = object(actor.state);
    const locationId = actor.location_id ? String(actor.location_id) : null;
    const residenceId = actor.residence_instance_id ? String(actor.residence_instance_id) : null;

    const entityRows = await database.client`
      SELECT item.instance_id, item.owner_id, item.location_id, item.state,
             definition.name, definition.concept_summary,
             revision.payload,
             EXISTS (
               SELECT 1 FROM game.entity_relations relation
               WHERE relation.source_instance_id = item.instance_id
                 AND relation.target_instance_id = ${input.actorId}
                 AND relation.relation_type IN ('carried_by', 'equipped_by', 'located_at')
             ) AS related_to_actor
      FROM game.entity_instances item
      JOIN game.entity_definitions definition ON definition.definition_id = item.definition_id
      LEFT JOIN game.definition_revisions revision
        ON revision.revision_id = definition.current_revision_id
      WHERE item.instance_id <> ${input.actorId}
        AND (
          item.owner_id = ${input.actorId}
          OR item.location_id = ${input.actorId}
          OR (${locationId}::uuid IS NOT NULL AND item.location_id = ${locationId})
          OR EXISTS (
            SELECT 1 FROM game.entity_relations relation
            WHERE relation.source_instance_id = item.instance_id
              AND relation.target_instance_id = ${input.actorId}
              AND relation.relation_type IN ('carried_by', 'equipped_by', 'located_at')
          )
        )
      ORDER BY item.owner_id = ${input.actorId} DESC, item.updated_at DESC
      LIMIT 24
    `;

    const candidates = entityRows.reduce<ConsumptionCandidate[]>((result, row) => {
      const state = object(row.state);
      const quantity = availableQuantity(state);
      if (quantity <= 0) return result;
      const owned = row.owner_id && String(row.owner_id) === input.actorId;
      const carried =
        (row.location_id && String(row.location_id) === input.actorId) ||
        Boolean(row.related_to_actor);
      const revisionPayload = object(row.payload);
      const cachedProfile = object(state.semanticProfile);
      result.push({
        sourceType: "entity",
        sourceId: String(row.instance_id),
        name: String(row.name),
        description: [
          String(row.concept_summary || row.name),
          Object.keys(revisionPayload).length
            ? `Definition: ${JSON.stringify(revisionPayload).slice(0, 1_000)}`
            : "",
          Object.keys(cachedProfile).length
            ? `Existing semantic profile: ${JSON.stringify(cachedProfile).slice(0, 1_000)}`
            : "",
        ]
          .filter(Boolean)
          .join("\n"),
        access: carried ? "carried" : owned ? "owned" : "visible",
        quantity: Math.min(quantity, 1_000),
        state,
        constraints: arrayOfStrings(state.constraints),
      });
      return result;
    }, []);

    const containers = [locationId, residenceId].filter((value): value is string => Boolean(value));
    if (containers.length) {
      const poolRows = await database.client`
        SELECT pool_id, name, description, units_remaining, constraints, state
        FROM game.ambient_asset_pools
        WHERE container_instance_id = ANY(${database.client.array(containers, 2950)})
          AND visibility = 'player_known'
          AND units_remaining > 0
        ORDER BY updated_at DESC
        LIMIT 8
      `;
      for (const row of poolRows) {
        candidates.push({
          sourceType: "ambient_pool",
          sourceId: String(row.pool_id),
          name: String(row.name),
          description: String(row.description),
          access: "ambient",
          quantity: Math.min(numeric(row.units_remaining, 0), 1_000),
          state: object(row.state),
          constraints: arrayOfStrings(row.constraints),
        });
      }
    }

    return {
      actorId: input.actorId,
      rawText: input.rawText,
      locationName: String(actor.location_name || "Unknown location"),
      locationDescription: String(actor.location_description || ""),
      actorState,
      candidates,
    };
  }

  async function commitConsumption(input: {
    userId: string;
    actorId: string;
    idempotencyKey: string;
    rawText: string;
    intent: ActionIntent;
    seed: string;
    analysis: ConsumableAnalysis;
    mechanics: ConsumptionMechanicsResult;
    policyVersion: string;
    analysisInputHash: string;
  }): Promise<ActionExecutionResponse> {
    const createdAt = new Date().toISOString();
    return database.client.begin(async (sql) => {
      const existing = await sql`
        SELECT 1 FROM game.event_ledger WHERE idempotency_key = ${input.idempotencyKey}
      `;
      if (existing.length) {
        throw new ConsumptionStoreError(
          "duplicate",
          "The idempotent consumption result was committed concurrently.",
        );
      }

      const actorRows = await sql`
        SELECT actor.location_id, actor.state, actor.condition,
               occupancy.residence_instance_id
        FROM game.player_characters pc
        JOIN game.entity_instances actor ON actor.instance_id = pc.character_instance_id
        LEFT JOIN game.residence_occupancies occupancy
          ON occupancy.character_instance_id = actor.instance_id AND occupancy.status = 'active'
        WHERE pc.user_id = ${input.userId}
          AND pc.character_instance_id = ${input.actorId}
        FOR UPDATE OF actor
      `;
      const actor = actorRows[0];
      if (!actor) {
        throw new ConsumptionStoreError(
          "forbidden",
          "Character is not controlled by this account.",
        );
      }

      const intentId = randomUUID();
      const resolutionId = randomUUID();
      const eventId = randomUUID();
      let concreteEntityId: string | null = null;
      let sourceId: string | null = input.analysis.selection.sourceId ?? null;
      let remainingUnits: number | null = null;
      let materialized = false;

      if (
        input.analysis.selection.sourceType !== "none" &&
        input.analysis.classification.consumable
      ) {
        if (!sourceId) {
          throw new ConsumptionStoreError("invalid_analysis", "Consumption source is missing.");
        }
        if (input.analysis.selection.sourceType === "entity") {
          const itemRows = await sql`
            SELECT item.instance_id, item.owner_id, item.location_id, item.state
            FROM game.entity_instances item
            WHERE item.instance_id = ${sourceId}
            FOR UPDATE
          `;
          const item = itemRows[0];
          if (!item)
            throw new ConsumptionStoreError("not_found", "Selected item no longer exists.");
          const actorLocation = actor.location_id ? String(actor.location_id) : null;
          const accessible =
            (item.owner_id && String(item.owner_id) === input.actorId) ||
            (item.location_id && String(item.location_id) === input.actorId) ||
            (actorLocation && item.location_id && String(item.location_id) === actorLocation);
          if (!accessible) {
            throw new ConsumptionStoreError("forbidden", "Selected item is no longer accessible.");
          }
          const itemState = object(item.state);
          const quantity = availableQuantity(itemState);
          if (quantity < input.analysis.consumeUnits) {
            throw new ConsumptionStoreError(
              "unavailable",
              "Selected item does not have enough remaining quantity.",
            );
          }
          remainingUnits = quantity - input.analysis.consumeUnits;
          await sql`
            UPDATE game.entity_instances
            SET state = ${json(applyQuantity(itemState, remainingUnits))}, updated_at = now()
            WHERE instance_id = ${sourceId}
          `;
          concreteEntityId = sourceId;
        } else {
          const poolRows = await sql`
            SELECT pool.pool_id, pool.container_instance_id, pool.units_remaining
            FROM game.ambient_asset_pools pool
            WHERE pool.pool_id = ${sourceId}
            FOR UPDATE
          `;
          const pool = poolRows[0];
          if (!pool)
            throw new ConsumptionStoreError("not_found", "Ambient resource no longer exists.");
          const allowedContainers = [
            actor.location_id ? String(actor.location_id) : null,
            actor.residence_instance_id ? String(actor.residence_instance_id) : null,
          ].filter(Boolean);
          if (!allowedContainers.includes(String(pool.container_instance_id))) {
            throw new ConsumptionStoreError(
              "forbidden",
              "Ambient resource is not accessible here.",
            );
          }
          const proposal = input.analysis.materialization;
          if (!proposal) {
            throw new ConsumptionStoreError(
              "invalid_analysis",
              "Ambient consumption requires a concrete materialization.",
            );
          }
          const poolQuantity = numeric(pool.units_remaining, 0);
          if (poolQuantity < proposal.unitsCreated) {
            throw new ConsumptionStoreError("unavailable", "Ambient resource has been depleted.");
          }
          await sql`
            UPDATE game.ambient_asset_pools
            SET units_remaining = units_remaining - ${proposal.unitsCreated}, updated_at = now()
            WHERE pool_id = ${sourceId}
          `;

          concreteEntityId = randomUUID();
          const definitionId = `AI-MUNDANE-${randomUUID()}`;
          const revisionId = randomUUID();
          remainingUnits = proposal.unitsCreated - input.analysis.consumeUnits;
          materialized = true;
          await sql`
            INSERT INTO game.entity_definitions (
              definition_id, definition_type, name, concept_summary, origin_source, lifecycle_status
            ) VALUES (
              ${definitionId}, 'item', ${proposal.name}, ${proposal.conceptSummary},
              'ai_ambient_materialization', 'approved'
            )
          `;
          await sql`
            INSERT INTO game.definition_revisions (
              revision_id, definition_id, payload, change_summary
            ) VALUES (
              ${revisionId}, ${definitionId},
              ${json({
                definitionType: "item",
                name: proposal.name,
                conceptSummary: proposal.conceptSummary,
                traits: proposal.descriptiveTraits.map((name) => ({
                  name,
                  type: "descriptive",
                  parameters: {},
                })),
                extensionPayload: {
                  semanticOrigin: "ambient_pool",
                  sourcePoolId: sourceId,
                },
                status: "approved",
              })},
              'Materialize an AI-inferred mundane ambient asset'
            )
          `;
          await sql`
            UPDATE game.entity_definitions
            SET current_revision_id = ${revisionId}, updated_at = now()
            WHERE definition_id = ${definitionId}
          `;
          await sql`
            INSERT INTO game.entity_instances (
              instance_id, definition_id, owner_id, location_id, state, created_event_id
            ) VALUES (
              ${concreteEntityId}, ${definitionId}, ${input.actorId}, ${input.actorId},
              ${json({
                quantity: remainingUnits,
                depleted: remainingUnits <= 0,
                sourcePoolId: sourceId,
                materializedByPolicy: input.policyVersion,
              })},
              ${eventId}
            )
          `;
        }
      }

      let actorState = object(actor.state);
      let conditionValue = numeric(actor.condition, 100);
      const resources = { ...object(actorState.resources) };
      for (const effect of input.mechanics.resourceDeltas) {
        if (effect.resource === "condition") {
          conditionValue = clamp(conditionValue + effect.delta, 0, 100);
        } else {
          resources[effect.resource] = clamp(
            numeric(resources[effect.resource], 0) + effect.delta,
            -100,
            100,
          );
        }
      }
      actorState = { ...actorState, resources };
      const activeConditions = { ...object(actorState.activeConditions) };
      for (const effect of input.mechanics.conditions) {
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
        SET state = ${json(actorState)}, condition = ${conditionValue}, updated_at = now()
        WHERE instance_id = ${input.actorId}
      `;

      const consumption: ConsumptionResult | undefined =
        input.analysis.selection.sourceType !== "none" && sourceId
          ? {
              sourceType: input.analysis.selection.sourceType,
              sourceId,
              displayName: input.analysis.selection.displayName,
              unitsConsumed: input.analysis.classification.consumable
                ? input.analysis.consumeUnits
                : 0,
              remainingUnits,
              materialized,
              resourceDeltas: input.mechanics.resourceDeltas,
              conditions: input.mechanics.conditions,
              risks: input.mechanics.risks,
            }
          : undefined;

      await sql`
        INSERT INTO game.action_intents (
          intent_id, actor_id, user_id, raw_text, parsed_intent,
          method_instance_id, target_location_id, idempotency_key
        ) VALUES (
          ${intentId}, ${input.actorId}, ${input.userId}, ${input.rawText},
          ${json(input.intent)}, ${input.actorId}, ${actor.location_id || null},
          ${input.idempotencyKey}
        )
      `;

      const involved = [input.actorId, sourceId, concreteEntityId].filter(Boolean);
      const eventPayload = {
        outcomeGrade: input.mechanics.outcomeGrade,
        margin: input.mechanics.outcomeGrade === "failure" ? -1 : 1,
        operations: [],
        informationGained: [],
        costs: consumption
          ? [{ resource: "consumable_units", amount: consumption.unitsConsumed }]
          : [],
        consumption,
        consumableAnalysis: input.analysis,
      };
      await sql`
        INSERT INTO game.event_ledger (
          event_id, idempotency_key, world_time, event_type,
          involved_entity_ids, payload, source_intent_id
        ) VALUES (
          ${eventId}, ${input.idempotencyKey}, ${createdAt}, 'consumption_resolved',
          ${json(involved)}, ${json(eventPayload)}, ${intentId}
        )
      `;

      await sql`
        INSERT INTO game.resolution_results (
          resolution_id, intent_id, event_id, outcome_grade, calculation_trace,
          proposed_operations, narrative_constraints, authoritative_seed,
          actor_score, target_score
        ) VALUES (
          ${resolutionId}, ${intentId}, ${eventId}, ${input.mechanics.outcomeGrade},
          ${json(input.mechanics.calculationTrace)}, '[]'::jsonb,
          ${json([
            "Use the selected substance's human-readable name.",
            "Do not imply effects beyond the committed resource deltas, conditions, or resolved risks.",
            "Do not expose semantic-analysis or database terminology.",
          ])},
          ${input.seed}, 0, 0
        )
      `;

      if (concreteEntityId) {
        await sql`
          INSERT INTO game.entity_semantic_profiles (
            entity_instance_id, profile_type, policy_version, input_hash, payload
          ) VALUES (
            ${concreteEntityId}, 'consumable', ${input.policyVersion},
            ${input.analysisInputHash}, ${json(input.analysis)}
          ) ON CONFLICT (entity_instance_id, profile_type, input_hash) DO NOTHING
        `;
        await sql`
          UPDATE game.entity_instances
          SET state = jsonb_set(
                state,
                '{semanticProfile}',
                ${json({
                  profileType: "consumable",
                  policyVersion: input.policyVersion,
                  classification: input.analysis.classification,
                  resourceDeltas: input.analysis.resourceDeltas,
                  conditions: input.analysis.conditions,
                  risks: input.analysis.risks,
                })},
                true
              ),
              updated_at = now()
          WHERE instance_id = ${concreteEntityId}
        `;
      }

      return {
        eventId,
        intentId,
        resolutionId,
        rawText: input.rawText,
        outcomeGrade: input.mechanics.outcomeGrade,
        margin: input.mechanics.outcomeGrade === "failure" ? -1 : 1,
        narration: "The consumption event has been committed and awaits narration.",
        calculationTrace: input.mechanics.calculationTrace,
        informationGained: [],
        costs: eventPayload.costs,
        ...(consumption ? { consumption } : {}),
        createdAt,
        idempotentReplay: false,
      };
    });
  }

  return { buildAnalysisRequest, commitConsumption };
}

export type ConsumptionStore = ReturnType<typeof createConsumptionStore>;
