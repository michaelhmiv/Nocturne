import { z } from "zod";
import { WorldActionKindSchema } from "./world-action.js";

export const GameplayTelemetryEventNameSchema = z.enum([
  "request_received",
  "authentication_resolved",
  "scope_resolved",
  "context_compilation_started",
  "context_compilation_completed",
  "reference_resolution_started",
  "reference_resolution_completed",
  "provider_call_started",
  "provider_call_completed",
  "provider_call_failed",
  "plan_created",
  "step_claimed",
  "resolution_mode_selected",
  "handler_started",
  "handler_completed",
  "handler_failed",
  "schedule_created",
  "resolution_committed",
  "event_committed",
  "mutation_receipt_committed",
  "step_completed",
  "step_waiting",
  "request_completed",
  "request_waiting",
  "request_failed",
]);
export type GameplayTelemetryEventName = z.infer<typeof GameplayTelemetryEventNameSchema>;

export const GameplayTelemetryStatusSchema = z.enum([
  "started",
  "completed",
  "waiting",
  "failed",
  "skipped",
]);
export type GameplayTelemetryStatus = z.infer<typeof GameplayTelemetryStatusSchema>;

const CorrelationIdSchema = z.string().trim().min(1).max(256);
const OptionalUuidSchema = z.string().uuid().optional();

export const GameplayTelemetryEventSchema = z
  .object({
    timestamp: z.string().datetime(),
    level: z.enum(["debug", "info", "warn", "error"]),
    eventName: GameplayTelemetryEventNameSchema,
    status: GameplayTelemetryStatusSchema,
    traceId: CorrelationIdSchema,
    requestId: OptionalUuidSchema,
    planId: OptionalUuidSchema,
    stepId: OptionalUuidSchema,
    scheduleId: OptionalUuidSchema,
    eventId: OptionalUuidSchema,
    mutationReceiptId: OptionalUuidSchema,
    idempotencyKeyHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    worldId: CorrelationIdSchema.optional(),
    shardId: CorrelationIdSchema.optional(),
    userId: CorrelationIdSchema.optional(),
    actorId: CorrelationIdSchema.optional(),
    actionKind: WorldActionKindSchema.optional(),
    actionType: z.string().trim().min(1).max(80).optional(),
    handler: z.string().trim().min(1).max(160).optional(),
    errorCode: z.string().trim().min(1).max(160).optional(),
    provider: z.string().trim().min(1).max(80).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    providerRequestId: z.string().trim().min(1).max(256).optional(),
    attempt: z.number().int().positive().optional(),
    durationMs: z.number().nonnegative().finite().optional(),
    committed: z.boolean(),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.status === "failed" && !event.errorCode) {
      context.addIssue({
        code: "custom",
        path: ["errorCode"],
        message: "Failed telemetry events require a stable errorCode",
      });
    }
    if (event.eventName === "handler_started" && !event.handler) {
      context.addIssue({
        code: "custom",
        path: ["handler"],
        message: "Handler lifecycle events require a handler name",
      });
    }
    if (
      [
        "step_claimed",
        "resolution_mode_selected",
        "handler_started",
        "handler_completed",
        "handler_failed",
        "step_completed",
        "step_waiting",
      ].includes(event.eventName) &&
      !event.stepId
    ) {
      context.addIssue({
        code: "custom",
        path: ["stepId"],
        message: "Step lifecycle events require stepId",
      });
    }
  });

export type GameplayTelemetryEvent = z.infer<typeof GameplayTelemetryEventSchema>;

export type GameplayTelemetryWriter = (event: GameplayTelemetryEvent) => void | Promise<void>;
