import { z } from "zod";

const UuidSchema = z.string().uuid();
const SemanticKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const TextSchema = z.string().trim().min(1).max(1_000);

export const PlayerVisibleResourceEffectSchema = z
  .object({
    type: z.literal("resource_changed"),
    resource: SemanticKeySchema,
    delta: z.number(),
    before: z.number().nullable().default(null),
    after: z.number().nullable().default(null),
    rationale: z.string().trim().max(1_000).nullable().default(null),
  })
  .strict();

export const PlayerVisibleConditionEffectSchema = z
  .object({
    type: z.literal("condition_changed"),
    conditionKey: SemanticKeySchema,
    name: z.string().trim().min(1).max(180),
    change: z.enum(["applied", "updated", "removed"]),
    intensity: z.number().nullable().default(null),
    expiresAt: z.string().datetime().nullable().default(null),
    rationale: z.string().trim().max(1_000).nullable().default(null),
  })
  .strict();

export const PlayerVisibleQuantityEffectSchema = z
  .object({
    type: z.literal("quantity_changed"),
    entityId: UuidSchema.nullable().default(null),
    name: z.string().trim().min(1).max(240),
    delta: z.number(),
    after: z.number().nullable().default(null),
    change: z.enum(["acquired", "consumed", "transferred", "destroyed", "adjusted"]),
  })
  .strict();

export const PlayerVisibleRiskEffectSchema = z
  .object({
    type: z.literal("risk_resolved"),
    description: TextSchema,
    occurred: z.boolean(),
  })
  .strict();

export const PlayerVisibleLocationEffectSchema = z
  .object({
    type: z.literal("location_changed"),
    entityId: UuidSchema.nullable().default(null),
    fromLocationId: UuidSchema.nullable().default(null),
    toLocationId: UuidSchema.nullable().default(null),
    toLocationName: z.string().trim().min(1).max(240).nullable().default(null),
  })
  .strict();

export const PlayerVisibleRelationshipEffectSchema = z
  .object({
    type: z.literal("relationship_changed"),
    entityId: UuidSchema.nullable().default(null),
    relationship: SemanticKeySchema,
    change: z.enum(["set", "removed", "increased", "decreased"]),
    before: z.number().nullable().default(null),
    after: z.number().nullable().default(null),
  })
  .strict();

export const PlayerVisibleFactEffectSchema = z
  .object({
    type: z.literal("fact_committed"),
    fact: TextSchema,
  })
  .strict();

export const PlayerVisibleEffectSchema = z.discriminatedUnion("type", [
  PlayerVisibleResourceEffectSchema,
  PlayerVisibleConditionEffectSchema,
  PlayerVisibleQuantityEffectSchema,
  PlayerVisibleRiskEffectSchema,
  PlayerVisibleLocationEffectSchema,
  PlayerVisibleRelationshipEffectSchema,
  PlayerVisibleFactEffectSchema,
]);
export type PlayerVisibleEffect = z.infer<typeof PlayerVisibleEffectSchema>;

export const PlayerEffectEventSchema = z
  .object({
    eventId: UuidSchema,
    actorId: UuidSchema,
    eventType: z.string().trim().min(1).max(120),
    occurredAt: z.string().datetime(),
    summary: TextSchema,
    effects: z.array(PlayerVisibleEffectSchema).max(64),
  })
  .strict();
export type PlayerEffectEvent = z.infer<typeof PlayerEffectEventSchema>;

export const PlayerEffectFeedSchema = z
  .object({
    actorId: UuidSchema,
    events: z.array(PlayerEffectEventSchema).max(200),
    generatedAt: z.string().datetime(),
  })
  .strict();
export type PlayerEffectFeed = z.infer<typeof PlayerEffectFeedSchema>;
