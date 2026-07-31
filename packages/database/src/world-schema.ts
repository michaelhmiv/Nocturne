import {
  index,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const game = pgSchema("game");

export const worlds = game.table(
  "worlds",
  {
    worldId: uuid("world_id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    clockMode: text("clock_mode").notNull().default("realtime"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("worlds_slug_uq").on(table.slug), index("worlds_status_idx").on(table.status)],
);

export const worldShards = game.table(
  "world_shards",
  {
    shardId: uuid("shard_id").primaryKey().defaultRandom(),
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.worldId, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("world_shards_world_slug_uq").on(table.worldId, table.slug),
    unique("world_shards_world_id_uq").on(table.worldId, table.shardId),
    index("world_shards_status_idx").on(table.worldId, table.status),
  ],
);

export const worldMemberships = game.table(
  "world_memberships",
  {
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.worldId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role").notNull().default("player"),
    status: text("status").notNull().default("active"),
    selectedCharacterId: uuid("selected_character_id"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.worldId, table.userId] }),
    index("world_memberships_user_idx").on(table.userId, table.status, table.joinedAt),
  ],
);

export const DEFAULT_WORLD_ID = "00000000-0000-4000-8000-000000000001";
export const DEFAULT_SHARD_ID = "00000000-0000-4000-8000-000000000002";
