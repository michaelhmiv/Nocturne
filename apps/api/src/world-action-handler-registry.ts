import type { WorldActionKind } from "@nocturne/contracts";
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

export function createWorldActionHandlerRegistry(dependencies: {
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

  return handlers;
}
