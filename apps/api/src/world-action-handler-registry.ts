import type { GameplayTelemetryWriter, WorldActionKind } from "@nocturne/contracts";
import {
  currentGameplayTraceId,
  hashIdempotencyKey,
  writeGameplayTelemetry,
} from "./gameplay-telemetry.js";
import type { SearchDiscoveryService } from "./search-discovery-service.js";
import type {
  WorldActionStepHandler,
  WorldActionStepHandlerResult,
} from "./persistent-world-action-service.js";

export class WorldActionHandlerRegistryError extends Error {
  constructor(
    readonly code: "invalid_payload" | "unsupported_handler",
    message: string,
  ) {
    super(message);
    this.name = "WorldActionHandlerRegistryError";
  }
}

const requiredString = (payload: Record<string, unknown>, key: string) => {
  const value = payload[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WorldActionHandlerRegistryError(
      "invalid_payload",
      `World action step is missing ${key}.`,
    );
  }
  return value;
};

const stableErrorCode = (error: unknown) =>
  error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string"
    ? String((error as { code: string }).code)
    : "handler_failed";

function instrumentHandler(
  kind: WorldActionKind,
  handler: WorldActionStepHandler,
  telemetry?: GameplayTelemetryWriter,
): WorldActionStepHandler {
  return async (input) => {
    const startedAt = Date.now();
    const common = {
      traceId: currentGameplayTraceId(input.requestId),
      requestId: input.requestId,
      planId: input.planId,
      stepId: input.step.stepId,
      idempotencyKeyHash: hashIdempotencyKey(input.step.idempotencyKey),
      worldId: input.scope.worldId,
      shardId: input.scope.shardId,
      userId: input.scope.userId,
      actorId: input.actorId,
      actionKind: kind,
      actionType:
        typeof input.step.intentPayload.actionType === "string"
          ? input.step.intentPayload.actionType
          : kind,
      handler: kind,
    } as const;
    await writeGameplayTelemetry(telemetry, {
      ...common,
      level: "info",
      eventName: "handler_started",
      status: "started",
      committed: false,
    });
    try {
      const result = await handler(input);
      await writeGameplayTelemetry(telemetry, {
        ...common,
        level: "info",
        eventName: "handler_completed",
        status: result.state === "waiting" ? "waiting" : "completed",
        eventId: result.state === "completed" ? result.eventId : undefined,
        mutationReceiptId: result.state === "completed" ? result.receiptId : undefined,
        scheduleId: result.state === "waiting" ? result.scheduleId : undefined,
        durationMs: Date.now() - startedAt,
        committed: result.state === "completed",
      });
      if (result.state === "waiting" && result.scheduleId) {
        await writeGameplayTelemetry(telemetry, {
          ...common,
          level: "info",
          eventName: "schedule_created",
          status: "waiting",
          scheduleId: result.scheduleId,
          committed: true,
        });
      }
      if (result.state === "completed") {
        await writeGameplayTelemetry(telemetry, {
          ...common,
          level: "info",
          eventName: "event_committed",
          status: "completed",
          eventId: result.eventId,
          mutationReceiptId: result.receiptId,
          committed: true,
        });
        if (result.receiptId) {
          await writeGameplayTelemetry(telemetry, {
            ...common,
            level: "info",
            eventName: "mutation_receipt_committed",
            status: "completed",
            eventId: result.eventId,
            mutationReceiptId: result.receiptId,
            committed: true,
          });
        }
      }
      return result;
    } catch (error) {
      await writeGameplayTelemetry(telemetry, {
        ...common,
        level: "error",
        eventName: "handler_failed",
        status: "failed",
        errorCode: stableErrorCode(error),
        durationMs: Date.now() - startedAt,
        committed: false,
      });
      throw error;
    }
  };
}

export function createWorldActionHandlerRegistry(dependencies: {
  telemetry?: GameplayTelemetryWriter;
  search?: SearchDiscoveryService;
  scheduleMove?(input: {
    scope: Parameters<WorldActionStepHandler>[0]["scope"];
    requestId: string;
    planId: string;
    stepId: string;
    actorId: string;
    destinationId: string;
    expectedVersions: Record<string, number>;
    idempotencyKey: string;
  }): Promise<{ scheduleId: string; narration: string }>;
  executeExistingAction?(input: {
    kind: Exclude<WorldActionKind, "search" | "move">;
    scope: Parameters<WorldActionStepHandler>[0]["scope"];
    actorId: string;
    rawText: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  }): Promise<WorldActionStepHandlerResult>;
}) {
  const handlers: Partial<Record<WorldActionKind, WorldActionStepHandler>> = {};

  if (dependencies.search) {
    handlers.search = async ({ scope, actorId, step }) => {
      const areaId = requiredString(step.intentPayload, "areaId");
      const requestedConcept = requiredString(step.intentPayload, "requestedConcept");
      const rawText =
        typeof step.intentPayload.rawText === "string"
          ? step.intentPayload.rawText
          : step.description;
      const result = await dependencies.search!.execute({
        scope,
        actorId,
        areaId,
        rawText,
        requestedConcept,
        idempotencyKey: step.idempotencyKey,
      });
      return {
        state: "completed",
        outcomeGrade: result.outcomeGrade,
        eventId: result.eventId,
        narration: result.playerVisibleFacts.join(" "),
      };
    };
  }

  if (dependencies.scheduleMove) {
    handlers.move = async ({ scope, requestId, planId, actorId, step }) => {
      const destinationId = requiredString(step.intentPayload, "destinationId");
      const scheduled = await dependencies.scheduleMove!({
        scope,
        requestId,
        planId,
        stepId: step.stepId,
        actorId,
        destinationId,
        expectedVersions: step.expectedVersions,
        idempotencyKey: step.idempotencyKey,
      });
      return {
        state: "waiting",
        planStatus: "waiting_for_time",
        reason: scheduled.narration,
        narration: scheduled.narration,
        scheduleId: scheduled.scheduleId,
      };
    };
  }

  if (dependencies.executeExistingAction) {
    for (const kind of [
      "consume",
      "relationship",
      "combat",
      "transfer",
      "interact",
      "dialogue",
      "question",
    ] as const) {
      handlers[kind] = async ({ scope, actorId, step }) =>
        dependencies.executeExistingAction!({
          kind,
          scope,
          actorId,
          rawText:
            typeof step.intentPayload.rawText === "string"
              ? step.intentPayload.rawText
              : step.description,
          idempotencyKey: step.idempotencyKey,
          payload: step.intentPayload,
        });
    }
  }

  for (const [kind, handler] of Object.entries(handlers) as [
    WorldActionKind,
    WorldActionStepHandler,
  ][]) {
    handlers[kind] = instrumentHandler(kind, handler, dependencies.telemetry);
  }

  return handlers;
}
