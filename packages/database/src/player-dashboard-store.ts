import { PlayerDashboardSchema, type PlayerDashboard } from "@nocturne/contracts";
import type { createDatabase } from "./index.js";
import { createPersistentSceneStore, type PersistentSceneStore } from "./persistent-scene-store.js";
import { createPlayerEffectStore, type PlayerEffectStore } from "./player-effect-store.js";
import type { WorldScope } from "./world-store.js";

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const numeric = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const nullableNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const text = (value: unknown, fallback: string) =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;

const uuid = (value: unknown): string | null => {
  const candidate = typeof value === "string" ? value.trim() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
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

const label = (key: string) =>
  key
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const numericRecord = (value: unknown) =>
  Object.fromEntries(
    Object.entries(object(value)).flatMap(([key, item]) => {
      const parsed = nullableNumber(item);
      return parsed === null ? [] : [[key, parsed]];
    }),
  );

function resourcesFromState(state: Record<string, unknown>) {
  return Object.entries(numericRecord(state.resources))
    .map(([key, value]) => ({
      key: semanticKey(key, "resource"),
      label: label(key),
      value,
      minimum: -100,
      maximum: 100,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function activeConditionsFromState(state: Record<string, unknown>) {
  return Object.entries(object(state.activeConditions))
    .map(([key, raw]) => {
      const condition = object(raw);
      return {
        key: semanticKey(key, "condition"),
        name: text(condition.name, label(key)),
        intensity: numeric(condition.intensity),
        expiresAt: isoDate(condition.expiresAt),
        rationale:
          typeof condition.rationale === "string" ? condition.rationale.slice(0, 1_000) : null,
        sourceEventId: uuid(condition.sourceEventId),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

function inventoryFromState(state: Record<string, unknown>) {
  if (!Array.isArray(state.inventory)) return [];
  return state.inventory.slice(0, 256).map((raw, index) => {
    const item = object(raw);
    return {
      instanceId: uuid(item.instanceId ?? item.entityId),
      title: text(item.title ?? item.name, `Item ${index + 1}`),
      quantity: nullableNumber(item.quantity ?? item.units ?? item.charges),
      equipped: item.equipped === true,
      condition: nullableNumber(item.condition),
    };
  });
}

function buildResourceHistory(effects: Awaited<ReturnType<PlayerEffectStore["list"]>>) {
  const groups = new Map<
    string,
    Array<{
      eventId: string;
      occurredAt: string;
      delta: number;
      after: number | null;
      summary: string;
    }>
  >();
  for (const event of [...effects.events].reverse()) {
    for (const effect of event.effects) {
      if (effect.type !== "resource_changed") continue;
      const points = groups.get(effect.resource) || [];
      points.push({
        eventId: event.eventId,
        occurredAt: event.occurredAt,
        delta: effect.delta,
        after: effect.after,
        summary: event.summary,
      });
      groups.set(effect.resource, points);
    }
  }
  return [...groups.entries()]
    .map(([resource, points]) => ({ resource, label: label(resource), points }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function createPlayerDashboardStore(
  database: ReturnType<typeof createDatabase>,
  dependencies?: {
    scene?: PersistentSceneStore;
    effects?: PlayerEffectStore;
  },
) {
  const scene = dependencies?.scene || createPersistentSceneStore(database);
  const effects = dependencies?.effects || createPlayerEffectStore(database);

  async function build(input: {
    scope: WorldScope;
    actorId: string;
    historyLimit?: number;
  }): Promise<PlayerDashboard> {
    const rows = await database.client<
      {
        instance_id: string;
        definition_id: string;
        name: string;
        concept_summary: string;
        version: string;
        simulation_version: string;
        lifecycle_status: string;
        condition: number;
        location_id: string | null;
        state: Record<string, unknown>;
        residence_instance_id: string | null;
      }[]
    >`
      SELECT actor.instance_id, definition.definition_id, definition.name,
             definition.concept_summary, actor.version::text,
             actor.simulation_version::text, actor.lifecycle_status,
             actor.condition, actor.location_id, actor.state,
             occupancy.residence_instance_id
      FROM game.player_characters character
      JOIN game.entity_instances actor
        ON actor.instance_id = character.character_instance_id
       AND actor.world_id = character.world_id
      JOIN game.entity_definitions definition
        ON definition.definition_id = actor.definition_id
      LEFT JOIN game.residence_occupancies occupancy
        ON occupancy.character_instance_id = actor.instance_id
       AND occupancy.status = 'active'
      WHERE character.world_id = ${input.scope.worldId}
        AND character.user_id = ${input.scope.userId}
        AND character.character_instance_id = ${input.actorId}
        AND actor.shard_id = ${input.scope.shardId}
      LIMIT 1
    `;
    const actor = rows[0];
    if (!actor) throw new Error("Actor is not controlled in this world.");

    const [sceneProjection, effectFeed] = await Promise.all([
      scene.build({ scope: input.scope, actorId: input.actorId }),
      effects.list({
        scope: input.scope,
        actorId: input.actorId,
        limit: Math.max(1, Math.min(input.historyLimit ?? 100, 200)),
      }),
    ]);
    const state = object(actor.state);

    return PlayerDashboardSchema.parse({
      character: {
        characterId: actor.instance_id,
        definitionId: actor.definition_id,
        name: actor.name,
        conceptSummary: actor.concept_summary,
        version: numeric(actor.version),
        simulationVersion: numeric(actor.simulation_version),
        lifecycleStatus: actor.lifecycle_status,
        condition: numeric(actor.condition, 100),
        locationId: actor.location_id,
        residenceId: actor.residence_instance_id,
        cashOnPerson: Math.trunc(numeric(state.cashOnPerson)),
        heat: numeric(state.heat),
        warrant: state.warrant === true,
        status: text(state.status, actor.lifecycle_status || "active"),
        resources: resourcesFromState(state),
        activeConditions: activeConditionsFromState(state),
        skills: numericRecord(state.skills),
        factionStanding: numericRecord(state.factionStanding),
        inventory: inventoryFromState(state),
      },
      scene: sceneProjection,
      effects: effectFeed,
      resourceHistory: buildResourceHistory(effectFeed),
      generatedAt: new Date().toISOString(),
    });
  }

  return { build };
}

export type PlayerDashboardStore = ReturnType<typeof createPlayerDashboardStore>;
