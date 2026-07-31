import { randomUUID } from "node:crypto";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";
import type { WorldScope } from "./world-store.js";

export type EntityLifecycleStatus =
  | "active"
  | "dormant"
  | "incapacitated"
  | "dead"
  | "destroyed"
  | "missing"
  | "retired"
  | "merged";

export type EntityAliasType =
  | "canonical"
  | "public"
  | "descriptive"
  | "private"
  | "mistaken"
  | "former";

export class EntityLifecycleError extends Error {
  constructor(
    readonly code:
      | "entity_not_found"
      | "stale_entity"
      | "invalid_transition"
      | "invalid_alias"
      | "cross_world_reference",
    message: string,
  ) {
    super(message);
    this.name = "EntityLifecycleError";
  }
}

const terminalStatuses = new Set<EntityLifecycleStatus>(["dead", "destroyed", "retired", "merged"]);

export function createEntityLifecycleStore(database: ReturnType<typeof createDatabase>) {
  async function getIdentity(scope: Pick<WorldScope, "worldId" | "shardId">, entityId: string) {
    const rows = await database.client<
      {
        instance_id: string;
        definition_id: string;
        definition_name: string;
        location_id: string | null;
        version: string;
        lifecycle_status: EntityLifecycleStatus;
        state: Record<string, unknown>;
        surviving_entity_id: string | null;
      }[]
    >`
      SELECT instance.instance_id,
             instance.definition_id,
             definition.name AS definition_name,
             instance.location_id,
             instance.version::text,
             instance.lifecycle_status,
             instance.state,
             tombstone.surviving_entity_id
      FROM game.entity_instances instance
      JOIN game.entity_definitions definition
        ON definition.definition_id = instance.definition_id
      LEFT JOIN game.entity_tombstones tombstone
        ON tombstone.world_id = instance.world_id
       AND tombstone.entity_instance_id = instance.instance_id
      WHERE instance.world_id = ${scope.worldId}
        AND instance.shard_id = ${scope.shardId}
        AND instance.instance_id = ${entityId}
    `;
    const row = rows[0];
    if (!row) throw new EntityLifecycleError("entity_not_found", "Entity not found in this world.");
    return {
      entityId: row.instance_id,
      definitionId: row.definition_id,
      definitionName: row.definition_name,
      locationId: row.location_id,
      version: Number(row.version),
      lifecycleStatus: row.lifecycle_status,
      state: row.state || {},
      survivingEntityId: row.surviving_entity_id,
    };
  }

  async function addAlias(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    entityId: string;
    aliasText: string;
    aliasType: EntityAliasType;
    viewpointId?: string;
    confidence?: number;
    sourceEventId?: string;
    metadata?: Record<string, unknown>;
  }) {
    const aliasText = input.aliasText.trim().replace(/\s+/g, " ");
    const confidence = input.confidence ?? 1;
    if (!aliasText || aliasText.length > 240 || confidence < 0 || confidence > 1) {
      throw new EntityLifecycleError("invalid_alias", "Alias is invalid.");
    }
    if (
      !input.viewpointId &&
      !["canonical", "public", "descriptive", "former"].includes(input.aliasType)
    ) {
      throw new EntityLifecycleError(
        "invalid_alias",
        "Private and mistaken aliases require a viewpoint.",
      );
    }
    await getIdentity(input.scope, input.entityId);
    if (input.viewpointId) await getIdentity(input.scope, input.viewpointId);
    const aliasId = randomUUID();
    const rows = await database.client<{ alias_id: string }[]>`
      INSERT INTO game.entity_aliases (
        alias_id, world_id, entity_instance_id, viewpoint_instance_id,
        alias_text, alias_type, confidence, source_event_id, metadata
      ) VALUES (
        ${aliasId}, ${input.scope.worldId}, ${input.entityId}, ${input.viewpointId || null},
        ${aliasText}, ${input.aliasType}, ${confidence}, ${input.sourceEventId || null},
        ${json(input.metadata || {})}::jsonb
      )
      ON CONFLICT DO NOTHING
      RETURNING alias_id
    `;
    if (rows[0]) return { aliasId: rows[0].alias_id, created: true };
    const existing = await database.client<{ alias_id: string }[]>`
      SELECT alias_id
      FROM game.entity_aliases
      WHERE world_id = ${input.scope.worldId}
        AND entity_instance_id = ${input.entityId}
        AND viewpoint_instance_id IS NOT DISTINCT FROM ${input.viewpointId || null}
        AND normalized_alias = lower(regexp_replace(${aliasText}, '\s+', ' ', 'g'))
        AND alias_type = ${input.aliasType}
        AND valid_until IS NULL
      LIMIT 1
    `;
    if (!existing[0]) throw new EntityLifecycleError("invalid_alias", "Alias conflict.");
    return { aliasId: existing[0].alias_id, created: false };
  }

  async function listAliases(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    entityId: string;
    viewpointId?: string;
  }) {
    await getIdentity(input.scope, input.entityId);
    const rows = await database.client<
      {
        alias_id: string;
        alias_text: string;
        alias_type: EntityAliasType;
        viewpoint_instance_id: string | null;
        confidence: string;
        valid_from: Date;
      }[]
    >`
      SELECT alias_id, alias_text, alias_type, viewpoint_instance_id,
             confidence::text, valid_from
      FROM game.entity_aliases
      WHERE world_id = ${input.scope.worldId}
        AND entity_instance_id = ${input.entityId}
        AND valid_until IS NULL
        AND (
          viewpoint_instance_id IS NULL
          OR viewpoint_instance_id = ${input.viewpointId || null}
        )
      ORDER BY
        CASE alias_type
          WHEN 'canonical' THEN 0
          WHEN 'public' THEN 1
          WHEN 'private' THEN 2
          WHEN 'descriptive' THEN 3
          WHEN 'mistaken' THEN 4
          ELSE 5
        END,
        valid_from DESC
    `;
    return rows.map((row) => ({
      aliasId: row.alias_id,
      aliasText: row.alias_text,
      aliasType: row.alias_type,
      viewpointId: row.viewpoint_instance_id,
      confidence: Number(row.confidence),
      validFrom: row.valid_from.toISOString(),
    }));
  }

  async function resolveAlias(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    aliasText: string;
    viewpointId?: string;
    limit?: number;
  }) {
    const normalized = input.aliasText.trim().replace(/\s+/g, " ").toLowerCase();
    if (!normalized) return [];
    const rows = await database.client<
      {
        entity_instance_id: string;
        alias_text: string;
        alias_type: EntityAliasType;
        viewpoint_instance_id: string | null;
        confidence: string;
        lifecycle_status: EntityLifecycleStatus;
        surviving_entity_id: string | null;
      }[]
    >`
      SELECT alias.entity_instance_id,
             alias.alias_text,
             alias.alias_type,
             alias.viewpoint_instance_id,
             alias.confidence::text,
             entity.lifecycle_status,
             tombstone.surviving_entity_id
      FROM game.entity_aliases alias
      JOIN game.entity_instances entity
        ON entity.instance_id = alias.entity_instance_id
       AND entity.world_id = alias.world_id
      LEFT JOIN game.entity_tombstones tombstone
        ON tombstone.world_id = alias.world_id
       AND tombstone.entity_instance_id = alias.entity_instance_id
      WHERE alias.world_id = ${input.scope.worldId}
        AND entity.shard_id = ${input.scope.shardId}
        AND alias.normalized_alias = ${normalized}
        AND alias.valid_until IS NULL
        AND (
          alias.viewpoint_instance_id IS NULL
          OR alias.viewpoint_instance_id = ${input.viewpointId || null}
        )
      ORDER BY
        CASE WHEN alias.viewpoint_instance_id = ${input.viewpointId || null} THEN 0 ELSE 1 END,
        alias.confidence DESC,
        alias.valid_from DESC
      LIMIT ${Math.max(1, Math.min(input.limit || 12, 50))}
    `;
    return rows.map((row) => ({
      entityId: row.surviving_entity_id || row.entity_instance_id,
      matchedEntityId: row.entity_instance_id,
      aliasText: row.alias_text,
      aliasType: row.alias_type,
      viewpointId: row.viewpoint_instance_id,
      confidence: Number(row.confidence),
      lifecycleStatus: row.lifecycle_status,
      redirected: Boolean(row.surviving_entity_id),
    }));
  }

  async function recordProvenance(input: {
    scope: Pick<WorldScope, "worldId">;
    entityId: string;
    sourceType:
      | "seed"
      | "migration"
      | "ai_materialization"
      | "ambient_pool"
      | "population_reservoir"
      | "prior_event"
      | "player_creation"
      | "crafting"
      | "invention"
      | "scheduled_arrival"
      | "administrative_repair";
    sourceId?: string;
    policyVersion?: string;
    inputHash?: string;
    payload?: Record<string, unknown>;
    createdEventId?: string;
  }) {
    const provenanceId = randomUUID();
    await database.client`
      INSERT INTO game.entity_provenance (
        provenance_id, world_id, entity_instance_id, source_type, source_id,
        policy_version, input_hash, payload, created_event_id
      ) VALUES (
        ${provenanceId}, ${input.scope.worldId}, ${input.entityId}, ${input.sourceType},
        ${input.sourceId || null}, ${input.policyVersion || null}, ${input.inputHash || null},
        ${json(input.payload || {})}::jsonb, ${input.createdEventId || null}
      )
      ON CONFLICT (world_id, entity_instance_id, source_type, source_id) DO NOTHING
    `;
    return { provenanceId };
  }

  async function transition(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    entityId: string;
    expectedVersion: number;
    lifecycleStatus: EntityLifecycleStatus;
    eventId: string;
    reason: string;
    survivingEntityId?: string;
  }) {
    if (input.lifecycleStatus === "merged" && !input.survivingEntityId) {
      throw new EntityLifecycleError("invalid_transition", "Merged entities require a survivor.");
    }
    if (input.lifecycleStatus !== "merged" && input.survivingEntityId) {
      throw new EntityLifecycleError(
        "invalid_transition",
        "Only merged entities can redirect to a survivor.",
      );
    }
    if (input.survivingEntityId) {
      await getIdentity(input.scope, input.survivingEntityId);
      if (input.survivingEntityId === input.entityId) {
        throw new EntityLifecycleError("invalid_transition", "Entity cannot merge into itself.");
      }
    }
    return database.client.begin(async (sql) => {
      const rows = await sql<
        { lifecycle_status: EntityLifecycleStatus; version: string }[]
      >`
        SELECT lifecycle_status, version::text
        FROM game.entity_instances
        WHERE world_id = ${input.scope.worldId}
          AND shard_id = ${input.scope.shardId}
          AND instance_id = ${input.entityId}
        FOR UPDATE
      `;
      const entity = rows[0];
      if (!entity) throw new EntityLifecycleError("entity_not_found", "Entity not found.");
      if (Number(entity.version) !== input.expectedVersion) {
        throw new EntityLifecycleError("stale_entity", "Entity changed before lifecycle transition.");
      }
      if (terminalStatuses.has(entity.lifecycle_status)) {
        throw new EntityLifecycleError(
          "invalid_transition",
          "Terminal entity lifecycle cannot be replaced by normal gameplay.",
        );
      }
      const terminal = terminalStatuses.has(input.lifecycleStatus);
      const updated = await sql<{ version: string }[]>`
        UPDATE game.entity_instances
        SET lifecycle_status = ${input.lifecycleStatus},
            retired_at = CASE WHEN ${terminal} THEN now() ELSE NULL END,
            retired_event_id = CASE WHEN ${terminal} THEN ${input.eventId}::uuid ELSE NULL END,
            version = version + 1,
            updated_at = now()
        WHERE world_id = ${input.scope.worldId}
          AND shard_id = ${input.scope.shardId}
          AND instance_id = ${input.entityId}
          AND version = ${input.expectedVersion}
        RETURNING version::text
      `;
      if (!updated[0]) {
        throw new EntityLifecycleError("stale_entity", "Entity changed before lifecycle transition.");
      }
      if (terminal) {
        await sql`
          INSERT INTO game.entity_tombstones (
            world_id, entity_instance_id, lifecycle_status,
            surviving_entity_id, reason, event_id
          ) VALUES (
            ${input.scope.worldId}, ${input.entityId}, ${input.lifecycleStatus},
            ${input.survivingEntityId || null}, ${input.reason}, ${input.eventId}
          )
          ON CONFLICT (world_id, entity_instance_id) DO NOTHING
        `;
      }
      return { entityId: input.entityId, version: Number(updated[0].version) };
    });
  }

  return {
    getIdentity,
    addAlias,
    listAliases,
    resolveAlias,
    recordProvenance,
    transition,
  };
}

export type EntityLifecycleStore = ReturnType<typeof createEntityLifecycleStore>;
