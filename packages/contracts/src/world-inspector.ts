import { z } from "zod";

const UuidSchema = z.string().uuid();
const TextSchema = z.string().trim().min(1).max(4_000);

export const WorldInspectorEntitySchema = z
  .object({
    entityId: UuidSchema,
    definitionId: z.string().trim().min(1).max(240),
    definitionType: z.string().trim().min(1).max(100),
    name: z.string().trim().min(1).max(240),
    worldId: UuidSchema,
    shardId: UuidSchema,
    version: z.number().int().nonnegative(),
    simulationVersion: z.number().int().nonnegative(),
    lifecycleStatus: z.string().trim().min(1).max(80),
    condition: z.number().int().min(0).max(100),
    locationId: UuidSchema.nullable(),
    ownerId: UuidSchema.nullable(),
    controllerId: UuidSchema.nullable(),
    state: z.record(z.string(), z.unknown()),
    provenance: z.array(z.record(z.string(), z.unknown())).max(64),
    aliases: z.array(z.record(z.string(), z.unknown())).max(64),
    relations: z.array(z.record(z.string(), z.unknown())).max(256),
    recentEvents: z.array(z.record(z.string(), z.unknown())).max(256),
    activePlans: z.array(z.record(z.string(), z.unknown())).max(64),
    scheduledWork: z.array(z.record(z.string(), z.unknown())).max(64),
    simulationRuns: z.array(z.record(z.string(), z.unknown())).max(64),
    latestContextReasons: z.array(z.record(z.string(), z.unknown())).max(64),
  })
  .strict();
export type WorldInspectorEntity = z.infer<typeof WorldInspectorEntitySchema>;

export const OperatorRepairRequestSchema = z.discriminatedUnion("actionType", [
  z
    .object({
      actionType: z.literal("cancel_plan"),
      planId: UuidSchema,
      reason: TextSchema,
    })
    .strict(),
  z
    .object({
      actionType: z.literal("relocate_entity"),
      entityId: UuidSchema,
      destinationId: UuidSchema,
      expectedVersion: z.number().int().nonnegative(),
      reason: TextSchema,
    })
    .strict(),
  z
    .object({
      actionType: z.literal("repair_relation"),
      sourceId: UuidSchema,
      targetId: UuidSchema,
      relationType: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      mode: z.enum(["set", "remove"]),
      parameters: z.record(z.string(), z.unknown()).default({}),
      reason: TextSchema,
    })
    .strict(),
  z
    .object({
      actionType: z.literal("compensating_event"),
      originalEventId: UuidSchema,
      explanation: TextSchema,
      operations: z.array(z.record(z.string(), z.unknown())).min(1).max(32),
      reason: TextSchema,
    })
    .strict(),
  z
    .object({
      actionType: z.literal("toggle_runtime_feature"),
      featureKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
      enabled: z.boolean(),
      configuration: z.record(z.string(), z.unknown()).default({}),
      reason: TextSchema,
    })
    .strict(),
]);
export type OperatorRepairRequest = z.infer<typeof OperatorRepairRequestSchema>;

export const OperatorRepairResultSchema = z
  .object({
    operatorActionId: UuidSchema,
    status: z.enum(["completed", "failed"]),
    eventId: UuidSchema.optional(),
    receiptId: UuidSchema.optional(),
  })
  .strict();
export type OperatorRepairResult = z.infer<typeof OperatorRepairResultSchema>;
