import {
  PlayerEffectEventSchema,
  PlayerEffectFeedSchema,
  PlayerVisibleEffectSchema,
  type PlayerEffectEvent,
  type PlayerVisibleEffect,
} from "@nocturne/contracts";
import type { createDatabase } from "./index.js";
import type { WorldScope } from "./world-store.js";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

const numeric = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const uuid = (value: unknown): string | null => {
  const candidate = text(value);
  return candidate &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null;
};

const isoDate = (value: unknown): string | null => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

const semanticKey = (value: unknown, fallback: string) => {
  const normalized = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return /^[a-z][a-z0-9_]{0,63}$/.test(normalized) ? normalized : fallback;
};

function addEffect(output: PlayerVisibleEffect[], fingerprints: Set<string>, candidate: unknown) {
  const parsed = PlayerVisibleEffectSchema.safeParse(candidate);
  if (!parsed.success) return;
  const fingerprint = JSON.stringify(parsed.data);
  if (fingerprints.has(fingerprint)) return;
  fingerprints.add(fingerprint);
  output.push(parsed.data);
}

function resourceEffects(output: PlayerVisibleEffect[], fingerprints: Set<string>, value: unknown) {
  for (const delta of records(value)) {
    const amount = numeric(delta.delta ?? delta.amount ?? delta.change);
    if (amount === null || amount === 0) continue;
    addEffect(output, fingerprints, {
      type: "resource_changed",
      resource: semanticKey(delta.resource ?? delta.key, "resource"),
      delta: amount,
      before: numeric(delta.before ?? delta.previousValue),
      after: numeric(delta.after ?? delta.resultingValue ?? delta.newValue),
      rationale: text(delta.rationale ?? delta.reason),
    });
  }
}

function conditionEffects(
  output: PlayerVisibleEffect[],
  fingerprints: Set<string>,
  value: unknown,
) {
  for (const condition of records(value)) {
    const name = text(condition.name) || text(condition.condition) || "Condition";
    const explicitChange = text(condition.change);
    const change = ["applied", "updated", "removed"].includes(explicitChange || "")
      ? explicitChange
      : condition.removed === true
        ? "removed"
        : "applied";
    addEffect(output, fingerprints, {
      type: "condition_changed",
      conditionKey: semanticKey(condition.key ?? condition.conditionKey ?? name, "condition"),
      name,
      change,
      intensity: numeric(condition.intensity),
      expiresAt: isoDate(condition.expiresAt),
      rationale: text(condition.rationale ?? condition.reason),
    });
  }
}

function riskEffects(output: PlayerVisibleEffect[], fingerprints: Set<string>, value: unknown) {
  for (const risk of records(value)) {
    const description = text(risk.description ?? risk.name);
    if (!description) continue;
    addEffect(output, fingerprints, {
      type: "risk_resolved",
      description,
      occurred: risk.occurred === true,
    });
  }
}

function operationEffects(
  output: PlayerVisibleEffect[],
  fingerprints: Set<string>,
  value: unknown,
) {
  for (const operation of records(value)) {
    const type = text(operation.type ?? operation.operationType);
    if (!type) continue;
    if (type === "adjust_resource") {
      resourceEffects(output, fingerprints, [operation]);
      continue;
    }
    if (type === "adjust_condition" || type === "set_condition") {
      const delta = numeric(operation.delta);
      if (delta !== null && delta !== 0) {
        addEffect(output, fingerprints, {
          type: "resource_changed",
          resource: "condition",
          delta,
          before: numeric(operation.before ?? operation.previousValue),
          after: numeric(operation.after ?? operation.resultingValue),
          rationale: text(operation.reason ?? operation.rationale),
        });
      }
      conditionEffects(output, fingerprints, operation.conditions ?? operation.conditionEffects);
      continue;
    }
    if (type === "move_entity") {
      addEffect(output, fingerprints, {
        type: "location_changed",
        entityId: uuid(operation.entityId ?? operation.instanceId),
        fromLocationId: uuid(operation.fromLocationId ?? operation.previousLocationId),
        toLocationId: uuid(
          operation.toLocationId ?? operation.destinationId ?? operation.locationId,
        ),
        toLocationName: text(operation.toLocationName ?? operation.destinationName),
      });
      continue;
    }
    if (type === "set_relation" || type === "remove_relation") {
      addEffect(output, fingerprints, {
        type: "relationship_changed",
        entityId: uuid(operation.targetId ?? operation.targetEntityId),
        relationship: semanticKey(operation.relationType ?? operation.relationship, "relationship"),
        change: type === "remove_relation" ? "removed" : "set",
        before: numeric(operation.before),
        after: numeric(operation.after),
      });
      continue;
    }
    if (
      ["transfer_possession", "transfer_ownership", "create_instance", "retire_entity"].includes(
        type,
      )
    ) {
      const name =
        text(operation.name ?? operation.entityName ?? operation.description) || "Entity";
      addEffect(output, fingerprints, {
        type: "quantity_changed",
        entityId: uuid(operation.entityId ?? operation.instanceId ?? operation.createdEntityId),
        name,
        delta: type === "retire_entity" ? -1 : 1,
        after: numeric(operation.after ?? operation.quantity),
        change:
          type === "create_instance"
            ? "acquired"
            : type === "retire_entity"
              ? "destroyed"
              : "transferred",
      });
    }
  }
}

export function normalizePlayerEffectEvent(input: {
  eventId: string;
  actorId: string;
  eventType: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}): PlayerEffectEvent {
  const effects: PlayerVisibleEffect[] = [];
  const fingerprints = new Set<string>();
  const consumption = object(input.payload.consumption);
  const ephemeral = object(input.payload.ephemeralConsumption);
  const consumed = Object.keys(consumption).length ? consumption : ephemeral;

  if (Object.keys(consumed).length) {
    resourceEffects(
      effects,
      fingerprints,
      consumed.resourceDeltas ?? consumed.appliedResourceDeltas,
    );
    conditionEffects(effects, fingerprints, consumed.conditions ?? consumed.appliedConditions);
    riskEffects(effects, fingerprints, consumed.risks);
    const contamination = object(consumed.contamination);
    if (Object.keys(contamination).length) {
      addEffect(effects, fingerprints, {
        type: "risk_resolved",
        description: "Contamination risk",
        occurred: contamination.occurred === true,
      });
    }
    const units = numeric(consumed.unitsConsumed);
    if (units !== null && units !== 0) {
      const selection = object(input.payload.consumableAnalysis).selection;
      addEffect(effects, fingerprints, {
        type: "quantity_changed",
        entityId: uuid(consumed.sourceId),
        name:
          text(consumed.displayName) ||
          text(ephemeral.concept) ||
          text(object(selection).displayName) ||
          "Consumable",
        delta: -Math.abs(units),
        after: numeric(consumed.remainingUnits),
        change: "consumed",
      });
    }
  }

  operationEffects(effects, fingerprints, input.payload.operations);
  operationEffects(effects, fingerprints, input.payload.operationResults);
  const receipt = object(input.payload.mutationReceipt ?? input.payload.receipt);
  operationEffects(effects, fingerprints, receipt.operationResults ?? receipt.operations);

  for (const fact of strings(input.payload.playerVisibleFacts).slice(0, 12)) {
    addEffect(effects, fingerprints, { type: "fact_committed", fact });
  }

  const summary =
    text(input.payload.playerSummary) ||
    text(input.payload.summary) ||
    strings(input.payload.playerVisibleFacts)[0] ||
    (Object.keys(consumed).length
      ? `Consumed ${text(consumed.displayName) || text(ephemeral.concept) || "a substance"}.`
      : input.eventType.replaceAll("_", " "));

  return PlayerEffectEventSchema.parse({
    eventId: input.eventId,
    actorId: input.actorId,
    eventType: input.eventType,
    occurredAt: input.occurredAt,
    summary,
    effects,
  });
}

export function createPlayerEffectStore(database: ReturnType<typeof createDatabase>) {
  async function list(input: {
    scope: Pick<WorldScope, "worldId" | "shardId" | "userId">;
    actorId: string;
    limit?: number;
  }) {
    const owned = await database.client<{ actor_id: string }[]>`
      SELECT character.character_instance_id AS actor_id
      FROM game.player_characters character
      JOIN game.entity_instances actor
        ON actor.instance_id = character.character_instance_id
       AND actor.world_id = character.world_id
      WHERE character.world_id = ${input.scope.worldId}
        AND character.user_id = ${input.scope.userId}
        AND actor.shard_id = ${input.scope.shardId}
        AND character.character_instance_id = ${input.actorId}
      LIMIT 1
    `;
    if (!owned[0]) throw new Error("Actor is not controlled in this world.");

    const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
    const rows = await database.client<
      { event_id: string; event_type: string; world_time: Date; payload: Record<string, unknown> }[]
    >`
      SELECT event_id, event_type, world_time, payload
      FROM game.event_ledger
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND involved_entity_ids ? ${input.actorId}
      ORDER BY world_time DESC, created_at DESC
      LIMIT ${limit}
    `;

    return PlayerEffectFeedSchema.parse({
      actorId: input.actorId,
      events: rows.map((row) =>
        normalizePlayerEffectEvent({
          eventId: row.event_id,
          actorId: input.actorId,
          eventType: row.event_type,
          occurredAt: row.world_time.toISOString(),
          payload: object(row.payload),
        }),
      ),
      generatedAt: new Date().toISOString(),
    });
  }

  return { list };
}

export type PlayerEffectStore = ReturnType<typeof createPlayerEffectStore>;
