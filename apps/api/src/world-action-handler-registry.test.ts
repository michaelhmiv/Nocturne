import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  GameplayTelemetryEvent,
  GameplayTelemetryWriter,
  WorldActionKind,
} from "@nocturne/contracts";
import { runWithGameplayTrace } from "./gameplay-telemetry.js";
import { createWorldActionHandlerRegistry } from "./world-action-handler-registry.js";

const scope = {
  worldId: randomUUID(),
  shardId: randomUUID(),
  userId: "test-user",
  role: "player" as const,
  selectedCharacterId: randomUUID(),
};

function input(kind: WorldActionKind) {
  const planId = randomUUID();
  return {
    scope,
    requestId: randomUUID(),
    planId,
    actorId: scope.selectedCharacterId!,
    step: {
      stepId: randomUUID(),
      planId,
      order: 1,
      kind,
      description: `test ${kind}`,
      status: "running",
      idempotencyKey: `test:${kind}`,
      intentPayload: {
        rawText: `test ${kind}`,
        actionType: kind,
        areaId: randomUUID(),
        requestedConcept: "evidence",
        destinationId: randomUUID(),
      },
      resolvedReferences: {},
      expectedVersions: {},
    },
    context: {} as never,
  };
}

function collector() {
  const events: GameplayTelemetryEvent[] = [];
  const writer: GameplayTelemetryWriter = (event) => {
    events.push(event);
  };
  return { events, writer };
}

describe("world action handler telemetry", () => {
  it("logs resolution selection, completion, and committed event for every synchronous handler", async () => {
    const { events, writer } = collector();
    const completed = async () => ({
      state: "completed" as const,
      outcomeGrade: "complete_success",
      eventId: randomUUID(),
      receiptId: randomUUID(),
      narration: "done",
    });
    const handlers = createWorldActionHandlerRegistry({
      telemetry: writer,
      executeExistingAction: completed,
      executeSemanticAction: completed,
      executeRoutineAction: completed,
    });

    for (const kind of [
      "consume",
      "relationship",
      "combat",
      "transfer",
      "interact",
      "dialogue",
      "question",
    ] as const) {
      await runWithGameplayTrace(`trace-${kind}`, () => handlers[kind]!(input(kind)));
      const actionEvents = events.filter((event) => event.actionKind === kind);
      expect(actionEvents.map((event) => event.eventName)).toEqual([
        "handler_started",
        "resolution_mode_selected",
        "handler_completed",
        ...(kind === "consume" ? (["resolution_committed"] as const) : []),
        "event_committed",
        "mutation_receipt_committed",
      ]);
      expect(actionEvents.every((event) => event.traceId === `trace-${kind}`)).toBe(true);
      expect(
        actionEvents.find((event) => event.eventName === "resolution_mode_selected")?.details,
      ).toMatchObject({ meaningfulUncertainty: expect.any(Boolean) });
    }
  });

  it("routes low-risk consumption to authoritative consumption mechanics, not routine bookkeeping", async () => {
    const existingCalls: string[] = [];
    const routineCalls: string[] = [];
    const handlers = createWorldActionHandlerRegistry({
      executeExistingAction: async ({ kind }) => {
        existingCalls.push(kind);
        return {
          state: "completed",
          outcomeGrade: "complete_success",
          eventId: randomUUID(),
          receiptId: randomUUID(),
          narration: "consumed",
        };
      },
      executeRoutineAction: async () => {
        routineCalls.push("routine");
        return {
          state: "completed",
          outcomeGrade: "complete_success",
          eventId: randomUUID(),
          receiptId: randomUUID(),
          narration: "routine",
        };
      },
      executeSemanticAction: async () => ({
        state: "completed",
        outcomeGrade: "complete_success",
        eventId: randomUUID(),
        receiptId: randomUUID(),
        narration: "semantic",
      }),
    });

    const consumeInput = input("consume");
    consumeInput.step.intentPayload.rawText = "Drink the water.";
    consumeInput.step.intentPayload.actionType = "consume";

    const result = await handlers.consume!(consumeInput);
    expect(result.state).toBe("completed");
    expect(existingCalls).toEqual(["consume"]);
    expect(routineCalls).toEqual([]);
  });

  it("never falls back to the legacy executor for non-consume actions", async () => {
    const existingCalls: string[] = [];
    const handlers = createWorldActionHandlerRegistry({
      executeExistingAction: async ({ kind }) => {
        existingCalls.push(kind);
        return {
          state: "completed",
          outcomeGrade: "complete_success",
          eventId: randomUUID(),
          narration: "legacy",
        };
      },
      executeSemanticAction: async () => ({
        state: "completed",
        outcomeGrade: "complete_success",
        eventId: randomUUID(),
        receiptId: randomUUID(),
        narration: "semantic",
      }),
    });

    const interactInput = input("interact");
    interactInput.step.intentPayload.rawText = "Open the red door.";
    interactInput.step.intentPayload.actionType = "interact";
    const result = await handlers.interact!(interactInput);

    expect(result.state).toBe("completed");
    expect(existingCalls).toEqual([]);
  });

  it("logs scheduled movement as waiting rather than failure", async () => {
    const { events, writer } = collector();
    const scheduleId = randomUUID();
    const handlers = createWorldActionHandlerRegistry({
      telemetry: writer,
      scheduleMove: async () => ({ scheduleId, narration: "Travel started." }),
    });

    const result = await runWithGameplayTrace("trace-move", () => handlers.move!(input("move")));
    expect(result.state).toBe("waiting");
    expect(events.map((event) => event.eventName)).toEqual([
      "handler_started",
      "handler_completed",
      "schedule_created",
    ]);
    expect(events.at(-1)?.scheduleId).toBe(scheduleId);
  });

  it("logs search completion and event commitment", async () => {
    const { events, writer } = collector();
    const handlers = createWorldActionHandlerRegistry({
      telemetry: writer,
      search: {
        execute: async () => ({
          outcomeGrade: "complete_success",
          eventId: randomUUID(),
          playerVisibleFacts: ["You find evidence."],
        }),
      } as never,
    });

    await runWithGameplayTrace("trace-search", () => handlers.search!(input("search")));
    expect(events.map((event) => event.eventName)).toEqual([
      "handler_started",
      "handler_completed",
      "event_committed",
    ]);
  });

  it("logs a stable failure event and never marks it committed", async () => {
    const { events, writer } = collector();
    const handlers = createWorldActionHandlerRegistry({
      telemetry: writer,
      executeExistingAction: async () => {
        throw Object.assign(new Error("provider failed"), { code: "provider_failure" });
      },
    });

    await expect(
      runWithGameplayTrace("trace-failure", () => handlers.consume!(input("consume"))),
    ).rejects.toThrow("provider failed");
    expect(events.at(-1)).toMatchObject({
      eventName: "handler_failed",
      status: "failed",
      errorCode: "provider_failure",
      committed: false,
    });
  });
});
