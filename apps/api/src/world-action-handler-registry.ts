import type {
  ActionResolutionDecision,
  GameplayTelemetryWriter,
  RelevanceCompiledContext,
  SemanticActionFrame,
  WorldActionKind,
} from "@nocturne/contracts";
import {
  currentGameplayTraceId,
  hashIdempotencyKey,
  writeGameplayTelemetry,
} from "./gameplay-telemetry.js";
import type { SearchDiscoveryService } from "./search-discovery-service.js";
import { adjudicateActionResolution } from "./resolution-mode-adjudicator.js";
import { deriveSemanticActionFrame } from "./semantic-action-frame.js";
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
  error instanceof Error &&
  "code" in error &&
  typeof (error as { code?: unknown }).code === "string"
    ? String((error as { code: string }).code)
    : "handler_failed";

const semanticExecutionModes = new Set<ActionResolutionDecision["mode"]>([
  "automatic_success",
  "automatic_failure",
  "clarification_required",
  "unopposed_check",
  "opposed_contest",
  "transaction",
  "conversation",
]);

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
        if (kind === "consume") {
          await writeGameplayTelemetry(telemetry, {
            ...common,
            level: "info",
            eventName: "resolution_committed",
            status: "completed",
            eventId: result.eventId,
            mutationReceiptId: result.receiptId,
            committed: true,
            details: { outcomeGrade: result.outcomeGrade },
          });
        }
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
  scheduleTimedAction?(input: {
    scope: Parameters<WorldActionStepHandler>[0]["scope"];
    actorId: string;
    planId: string;
    stepId: string;
    idempotencyKey: string;
    frame: SemanticActionFrame;
    resolution: ActionResolutionDecision;
    expectedVersions: Record<string, number>;
  }): Promise<WorldActionStepHandlerResult>;
  executeRoutineAction?(input: {
    scope: Parameters<WorldActionStepHandler>[0]["scope"];
    actorId: string;
    planId: string;
    stepId: string;
    idempotencyKey: string;
    frame: SemanticActionFrame;
    resolution: ActionResolutionDecision;
  }): Promise<WorldActionStepHandlerResult>;
  executeSemanticAction?(input: {
    scope: Parameters<WorldActionStepHandler>[0]["scope"];
    actorId: string;
    planId: string;
    stepId: string;
    idempotencyKey: string;
    frame: SemanticActionFrame;
    resolution: ActionResolutionDecision;
    context: RelevanceCompiledContext;
  }): Promise<WorldActionStepHandlerResult>;
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

  if (dependencies.executeExistingAction || dependencies.executeSemanticAction) {
    for (const kind of [
      "consume",
      "relationship",
      "combat",
      "transfer",
      "interact",
      "dialogue",
      "question",
    ] as const) {
      handlers[kind] = async ({ scope, actorId, planId, requestId, step, context }) => {
        const rawText =
          typeof step.intentPayload.rawText === "string"
            ? step.intentPayload.rawText
            : step.description;
        const frame = deriveSemanticActionFrame({
          kind,
          actorId,
          rawText,
          payload: step.intentPayload,
          resolvedReferences: step.resolvedReferences,
          context,
        });
        const resolution = adjudicateActionResolution(frame, context);
        await writeGameplayTelemetry(dependencies.telemetry, {
          level: "info",
          eventName: "resolution_mode_selected",
          status: "completed",
          traceId: currentGameplayTraceId(requestId),
          requestId,
          planId,
          stepId: step.stepId,
          idempotencyKeyHash: hashIdempotencyKey(step.idempotencyKey),
          worldId: scope.worldId,
          shardId: scope.shardId,
          userId: scope.userId,
          actorId,
          actionKind: kind,
          actionType: frame.actionType,
          committed: false,
          details: {
            mode: resolution.mode,
            meaningfulUncertainty: resolution.meaningfulUncertainty,
            difficulty: resolution.difficulty,
            opposition: resolution.opposition,
            consequenceLevel: resolution.consequenceLevel,
            rationale: resolution.rationale,
          },
        });
        if (
          dependencies.executeRoutineAction &&
          ["automatic_success", "automatic_failure"].includes(resolution.mode)
        ) {
          return dependencies.executeRoutineAction({
            scope,
            actorId,
            planId,
            stepId: step.stepId,
            idempotencyKey: step.idempotencyKey,
            frame,
            resolution,
          });
        }
        if (
          kind !== "consume" &&
          resolution.mode === "timed_task" &&
          dependencies.scheduleTimedAction
        ) {
          return dependencies.scheduleTimedAction({
            scope,
            actorId,
            planId,
            stepId: step.stepId,
            idempotencyKey: step.idempotencyKey,
            frame,
            resolution,
            expectedVersions: step.expectedVersions,
          });
        }
        if (
          kind !== "consume" &&
          dependencies.executeSemanticAction &&
          semanticExecutionModes.has(resolution.mode)
        ) {
          return dependencies.executeSemanticAction({
            scope,
            actorId,
            planId,
            stepId: step.stepId,
            idempotencyKey: step.idempotencyKey,
            frame,
            resolution,
            context,
          });
        }
        if (!dependencies.executeExistingAction) {
          throw new WorldActionHandlerRegistryError(
            "unsupported_handler",
            `No executor is configured for ${kind}:${resolution.mode}.`,
          );
        }
        return dependencies.executeExistingAction({
          kind,
          scope,
          actorId,
          rawText,
          idempotencyKey: step.idempotencyKey,
          payload: {
            ...step.intentPayload,
            actionFrame: frame,
            actionType: frame.actionType,
            resolution,
          },
        });
      };
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
