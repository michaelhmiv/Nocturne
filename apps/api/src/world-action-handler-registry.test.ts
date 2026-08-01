import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
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
  it("logs start, completion, and committed event for every synchronous handler", async () => {
    const { events, writer } = collector();
    const handlers = createWorldActionHandlerRegistry({
      telemetry: writer,
      executeExistingAction: async () => ({
        state: "completed",
        outcomeGrade: "complete_success",
        eventId: randomUUID(),
        receiptId: randomUUID(),
        narration: "done",
      }),
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
        "handler_completed",
        ...(kind === "consume" ? (["resolution_committed"] as const) : []),
        "event_committed",
        "mutation_receipt_committed",
      ]);
      expect(actionEvents.every((event) => event.traceId === `trace-${kind}`)).toBe(true);
    }
  });

  it("routes ephemeral environmental consumption without invoking the legacy action service", async () => {
    const { events, writer } = collector();
    const executeExistingAction = vi.fn();
    const executeEphemeral = vi.fn().mockResolvedValue({
      state: "completed" as const,
      outcomeGrade: "complete_success",
      eventId: randomUUID(),
      narration: "You chew the old gum. It provides no nutrition.",
    });
    const handlers = createWorldActionHandlerRegistry({
      telemetry: writer,
      executeExistingAction,
      ephemeralConsumption: { execute: executeEphemeral } as never,
    });
    const consumeInput = input("consume");
    consumeInput.step.intentPayload = {
      rawText: "I eat gum off a light pole.",
      actionType: "consume",
      requestedConcept: "old chewing gum",
      sourceMode: "ephemeral_environmental",
      environmentalAffordances: [
        {
          concept: "old chewing gum",
          role: "object",
          status: "plausible_ephemeral",
        },
        {
          concept: "generic municipal light pole",
          role: "source",
          status: "plausible_ephemeral",
        },
      ],
    };

    const result = await runWithGameplayTrace("trace-ephemeral", () =>
      handlers.consume!(consumeInput),
    );

    expect(result.state).toBe("completed");
    expect(executeEphemeral).toHaveBeenCalledWith(
      expect.objectContaining({
        rawText: "I eat gum off a light pole.",
        payload: expect.objectContaining({ sourceMode: "ephemeral_environmental" }),
      }),
    );
    expect(executeExistingAction).not.toHaveBeenCalled();
    expect(events.map((event) => event.eventName)).toEqual([
      "handler_started",
      "handler_completed",
      "resolution_committed",
      "event_committed",
    ]);
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
