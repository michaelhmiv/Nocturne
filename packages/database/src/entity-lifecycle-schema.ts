import { index, jsonb, numeric, pgSchema, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { worlds } from "./world-schema.js";

const game = pgSchema("game");

export const entityAliases = game.table(
  "entity_aliases",
  {
    aliasId: uuid("alias_id").primaryKey().defaultRandom(),
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.worldId, { onDelete: "cascade" }),
    entityInstanceId: uuid("entity_instance_id").notNull(),
    viewpointInstanceId: uuid("viewpoint_instance_id"),
    aliasText: text("alias_text").notNull(),
    aliasType: text("alias_type").notNull().default("descriptive"),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull().default("1"),
    sourceEventId: uuid("source_event_id"),
    validFrom: timestamp("valid_from", { withTimezone: true }).notNull().defaultNow(),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    supersededByAliasId: uuid("superseded_by_alias_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("entity_aliases_entity_idx").on(table.worldId, table.entityInstanceId, table.validFrom),
    index("entity_aliases_viewpoint_idx").on(
      table.worldId,
      table.viewpointInstanceId,
      table.validFrom,
    ),
  ],
);

export const entityProvenance = game.table(
  "entity_provenance",
  {
    provenanceId: uuid("provenance_id").primaryKey().defaultRandom(),
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.worldId, { onDelete: "cascade" }),
    entityInstanceId: uuid("entity_instance_id").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id"),
    policyVersion: text("policy_version"),
    inputHash: text("input_hash"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    createdEventId: uuid("created_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("entity_provenance_source_uq").on(
      table.worldId,
      table.entityInstanceId,
      table.sourceType,
      table.sourceId,
    ),
    index("entity_provenance_entity_idx").on(
      table.worldId,
      table.entityInstanceId,
      table.createdAt,
    ),
  ],
);

export const entityTombstones = game.table(
  "entity_tombstones",
  {
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.worldId, { onDelete: "cascade" }),
    entityInstanceId: uuid("entity_instance_id").notNull(),
    lifecycleStatus: text("lifecycle_status").notNull(),
    survivingEntityId: uuid("surviving_entity_id"),
    reason: text("reason").notNull(),
    eventId: uuid("event_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.worldId, table.entityInstanceId] }),
    index("entity_tombstones_survivor_idx").on(table.worldId, table.survivingEntityId),
  ],
);
