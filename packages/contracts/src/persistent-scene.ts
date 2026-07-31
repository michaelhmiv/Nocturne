import { z } from "zod";
import { PersistentActionPlanSchema } from "./action-plans.js";

const UuidSchema = z.string().uuid();

export const PersistentSceneEntitySchema = z
  .object({
    entityId: UuidSchema,
    name: z.string().trim().min(1).max(240),
    definitionType: z.string().trim().min(1).max(100),
    lifecycleStatus: z.string().trim().min(1).max(80),
    locationId: UuidSchema.nullable(),
    locationName: z.string().trim().min(1).max(240).nullable(),
    relationshipLabels: z.array(z.string().trim().min(1).max(120)).max(24),
    aliases: z.array(z.string().trim().min(1).max(240)).max(24),
    statusSummary: z.string().trim().min(1).max(500).nullable(),
    lastObservedAt: z.string().datetime().nullable(),
    presence: z.enum(["nearby", "accompanying", "carried", "known_elsewhere"]),
  })
  .strict();
export type PersistentSceneEntity = z.infer<typeof PersistentSceneEntitySchema>;

export const PersistentScheduledWorkSchema = z
  .object({
    scheduleId: UuidSchema,
    kind: z.string().trim().min(1).max(100),
    description: z.string().trim().min(1).max(1_000),
    status: z.string().trim().min(1).max(80),
    resolvesAt: z.string().datetime(),
    planId: UuidSchema.nullable(),
    stepId: UuidSchema.nullable(),
  })
  .strict();

export const PersistentWorldSceneSchema = z
  .object({
    worldId: UuidSchema,
    shardId: UuidSchema,
    actorId: UuidSchema,
    location: z
      .object({
        locationId: UuidSchema.nullable(),
        name: z.string().trim().min(1).max(240),
        hierarchy: z
          .array(
            z.object({ locationId: UuidSchema, name: z.string().trim().min(1).max(240) }).strict(),
          )
          .max(16),
      })
      .strict(),
    nearbyEntities: z.array(PersistentSceneEntitySchema).max(96),
    accompanyingEntities: z.array(PersistentSceneEntitySchema).max(64),
    knownEntities: z.array(PersistentSceneEntitySchema).max(96),
    activePlan: PersistentActionPlanSchema.nullable(),
    scheduledWork: z.array(PersistentScheduledWorkSchema).max(64),
    recentEvents: z
      .array(
        z
          .object({
            eventId: UuidSchema,
            eventType: z.string().trim().min(1).max(120),
            occurredAt: z.string().datetime(),
            summary: z.string().trim().min(1).max(1_000),
          })
          .strict(),
      )
      .max(50),
    runtimeVersion: z.string().trim().min(1).max(120),
  })
  .strict();
export type PersistentWorldScene = z.infer<typeof PersistentWorldSceneSchema>;
