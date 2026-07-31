import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GameplayTelemetryEventSchema,
  type GameplayTelemetryEvent,
} from "../../packages/contracts/src/index.js";

const base = (): GameplayTelemetryEvent => ({
  timestamp: new Date().toISOString(),
  level: "info",
  eventName: "request_received",
  status: "started",
  traceId: randomUUID(),
  requestId: randomUUID(),
  worldId: randomUUID(),
  shardId: randomUUID(),
  actorId: randomUUID(),
  actionKind: "interact",
  committed: false,
});

describe("gameplay telemetry contract", () => {
  it("accepts a fully correlated request lifecycle event", () => {
    expect(GameplayTelemetryEventSchema.parse(base())).toMatchObject({
      eventName: "request_received",
      committed: false,
    });
  });

  it("rejects failed events without stable error codes", () => {
    expect(() =>
      GameplayTelemetryEventSchema.parse({
        ...base(),
        eventName: "request_failed",
        status: "failed",
        level: "error",
      }),
    ).toThrow(/errorCode/);
  });

  it("rejects handler events without a named handler", () => {
    expect(() =>
      GameplayTelemetryEventSchema.parse({
        ...base(),
        eventName: "handler_started",
        status: "started",
        stepId: randomUUID(),
      }),
    ).toThrow(/handler/);
  });

  it("rejects step lifecycle events without step correlation", () => {
    expect(() =>
      GameplayTelemetryEventSchema.parse({
        ...base(),
        eventName: "step_completed",
        status: "completed",
        committed: true,
      }),
    ).toThrow(/stepId/);
  });

  it("accepts committed handler completion with event and receipt correlation", () => {
    const parsed = GameplayTelemetryEventSchema.parse({
      ...base(),
      eventName: "handler_completed",
      status: "completed",
      handler: "consume",
      stepId: randomUUID(),
      eventId: randomUUID(),
      mutationReceiptId: randomUUID(),
      committed: true,
      durationMs: 12,
    });
    expect(parsed.committed).toBe(true);
  });
});
