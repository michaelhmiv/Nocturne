import { z } from "zod";

const UuidSchema = z.string().uuid();

export const OperatorActionStageSchema = z
  .object({
    stageId: UuidSchema,
    order: z.number().int().positive(),
    type: z.string().trim().min(1).max(120),
    status: z.enum(["started", "completed", "failed", "waiting", "skipped"]),
    inputSummary: z.record(z.string(), z.unknown()),
    outputSummary: z.record(z.string(), z.unknown()),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
  })
  .strict();

export const OperatorActionTraceSchema = z
  .object({
    requestId: UuidSchema,
    command: z.string().trim().min(1).max(4_000),
    status: z.string().trim().min(1).max(120),
    errorCode: z.string().trim().min(1).max(240).nullable(),
    planId: UuidSchema.nullable(),
    contextCompilationId: UuidSchema.nullable(),
    authoritativeResult: z.record(z.string(), z.unknown()).nullable(),
    playerSafeResult: z.record(z.string(), z.unknown()).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    stages: z.array(OperatorActionStageSchema).max(32),
  })
  .strict();

export const OperatorHandlerRegistrationSchema = z
  .object({
    actionKind: z.string().trim().min(1).max(120),
    handlerVersion: z.string().trim().min(1).max(120),
    authorityMode: z.string().trim().min(1).max(120),
    supportsStateChange: z.boolean(),
    enabled: z.boolean(),
    description: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const OperatorDashboardSchema = z
  .object({
    actorId: UuidSchema,
    traces: z.array(OperatorActionTraceSchema).max(100),
    handlers: z.array(OperatorHandlerRegistrationSchema).max(64),
    generatedAt: z.string().datetime(),
  })
  .strict();

export type OperatorActionStage = z.infer<typeof OperatorActionStageSchema>;
export type OperatorActionTrace = z.infer<typeof OperatorActionTraceSchema>;
export type OperatorDashboard = z.infer<typeof OperatorDashboardSchema>;
