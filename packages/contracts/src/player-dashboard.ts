import { z } from "zod";
import { PersistentWorldSceneSchema } from "./persistent-scene.js";
import { PlayerEffectFeedSchema } from "./player-effects.js";
import { WorldResourceKeySchema } from "./resource.js";

const UuidSchema = z.string().uuid();
const SemanticKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

export const PlayerDashboardResourceSchema = z
  .object({
    key: WorldResourceKeySchema,
    label: z.string().trim().min(1).max(120),
    value: z.number(),
    minimum: z.number().default(-100),
    maximum: z.number().default(100),
  })
  .strict();

export const PlayerDashboardConditionSchema = z
  .object({
    key: SemanticKeySchema,
    name: z.string().trim().min(1).max(180),
    intensity: z.number(),
    expiresAt: z.string().datetime().nullable(),
    rationale: z.string().trim().max(1_000).nullable(),
    sourceEventId: UuidSchema.nullable(),
  })
  .strict();

export const PlayerDashboardInventoryItemSchema = z
  .object({
    instanceId: UuidSchema.nullable(),
    title: z.string().trim().min(1).max(240),
    quantity: z.number().nullable(),
    equipped: z.boolean().default(false),
    condition: z.number().nullable().default(null),
  })
  .strict();

export const PlayerDashboardCharacterSchema = z
  .object({
    characterId: UuidSchema,
    definitionId: z.string().trim().min(1).max(240),
    name: z.string().trim().min(1).max(240),
    conceptSummary: z.string().trim().min(1).max(2_000),
    version: z.number().int().nonnegative(),
    simulationVersion: z.number().int().nonnegative(),
    lifecycleStatus: z.string().trim().min(1).max(80),
    condition: z.number().min(0).max(100),
    locationId: UuidSchema.nullable(),
    residenceId: UuidSchema.nullable(),
    cashOnPerson: z.number().int(),
    heat: z.number(),
    warrant: z.boolean(),
    status: z.string().trim().min(1).max(120),
    resources: z.array(PlayerDashboardResourceSchema).max(64),
    activeConditions: z.array(PlayerDashboardConditionSchema).max(64),
    skills: z.record(z.string(), z.number()),
    factionStanding: z.record(z.string(), z.number()),
    inventory: z.array(PlayerDashboardInventoryItemSchema).max(256),
  })
  .strict();

export const PlayerDashboardHistoryPointSchema = z
  .object({
    eventId: UuidSchema,
    occurredAt: z.string().datetime(),
    delta: z.number(),
    after: z.number().nullable(),
    summary: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const PlayerDashboardResourceHistorySchema = z
  .object({
    resource: WorldResourceKeySchema,
    label: z.string().trim().min(1).max(120),
    points: z.array(PlayerDashboardHistoryPointSchema).max(200),
  })
  .strict();

export const PlayerDashboardSchema = z
  .object({
    character: PlayerDashboardCharacterSchema,
    scene: PersistentWorldSceneSchema,
    effects: PlayerEffectFeedSchema,
    resourceHistory: z.array(PlayerDashboardResourceHistorySchema).max(64),
    generatedAt: z.string().datetime(),
  })
  .strict();

export type PlayerDashboardResource = z.infer<typeof PlayerDashboardResourceSchema>;
export type PlayerDashboardCondition = z.infer<typeof PlayerDashboardConditionSchema>;
export type PlayerDashboardCharacter = z.infer<typeof PlayerDashboardCharacterSchema>;
export type PlayerDashboard = z.infer<typeof PlayerDashboardSchema>;
