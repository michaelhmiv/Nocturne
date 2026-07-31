import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  GameplayTelemetryEventSchema,
  type GameplayTelemetryEventName,
} from "../../packages/contracts/src/index.js";
import { ACTION_TYPES, resolveContest } from "../../packages/rules-engine/src/index.js";
import {
  ACTION_CAPABILITIES,
  ALL_OUTCOME_GRADES,
  type CertifiedOutcomeGrade,
} from "../capabilities/action-capabilities.js";

const shardIndex = Number(process.env.ACTION_MATRIX_SHARD_INDEX || 0);
const shardTotal = Number(process.env.ACTION_MATRIX_SHARD_TOTAL || 1);
if (
  !Number.isInteger(shardIndex) ||
  !Number.isInteger(shardTotal) ||
  shardIndex < 0 ||
  shardTotal < 1 ||
  shardIndex >= shardTotal
) {
  throw new Error(
    "ACTION_MATRIX_SHARD_INDEX and ACTION_MATRIX_SHARD_TOTAL define an invalid shard.",
  );
}

const selectedActions = ACTION_TYPES.filter((_, index) => index % shardTotal === shardIndex);
const marginForGrade: Record<CertifiedOutcomeGrade, number> = {
  complete_success: 6,
  success_with_consequence: 3,
  partial_success: 0,
  failure_with_progress: -3,
  failure: -6,
  catastrophic_reversal: -7,
};

function eventFor(name: GameplayTelemetryEventName, actionType: string) {
  const stepEvent = [
    "step_claimed",
    "handler_started",
    "handler_completed",
    "handler_failed",
    "step_completed",
    "step_waiting",
  ].includes(name);
  const failed = name.endsWith("failed") || name === "request_failed";
  const committed = [
    "schedule_created",
    "resolution_committed",
    "event_committed",
    "mutation_receipt_committed",
    "step_completed",
    "request_completed",
    "request_waiting",
  ].includes(name);
  return GameplayTelemetryEventSchema.parse({
    timestamp: new Date().toISOString(),
    level: failed ? "error" : "info",
    eventName: name,
    status: failed
      ? "failed"
      : name.includes("waiting") || name === "schedule_created"
        ? "waiting"
        : name.endsWith("started") || name === "request_received" || name === "step_claimed"
          ? "started"
          : "completed",
    traceId: `matrix-${actionType}`,
    requestId: randomUUID(),
    planId: randomUUID(),
    stepId: stepEvent ? randomUUID() : undefined,
    scheduleId: name === "schedule_created" ? randomUUID() : undefined,
    eventId: name === "event_committed" ? randomUUID() : undefined,
    mutationReceiptId: name === "mutation_receipt_committed" ? randomUUID() : undefined,
    idempotencyKeyHash: "a".repeat(64),
    worldId: randomUUID(),
    shardId: randomUUID(),
    userId: "matrix-user",
    actorId: randomUUID(),
    actionKind: ACTION_CAPABILITIES[actionType as keyof typeof ACTION_CAPABILITIES].worldKind,
    actionType,
    handler: name.startsWith("handler_")
      ? ACTION_CAPABILITIES[actionType as keyof typeof ACTION_CAPABILITIES].worldKind
      : undefined,
    errorCode: failed ? "certified_failure" : undefined,
    committed,
  });
}

describe(`exhaustive action matrix shard ${shardIndex + 1}/${shardTotal}`, () => {
  it("contains at least one action when the shard count does not exceed the action count", () => {
    if (shardTotal <= ACTION_TYPES.length) expect(selectedActions.length).toBeGreaterThan(0);
  });

  it.each(selectedActions)("certifies all declared requirements for %s", (actionType) => {
    const capability = ACTION_CAPABILITIES[actionType];
    expect(capability.canonicalPrompts.length).toBeGreaterThanOrEqual(2);
    expect(capability.requiredDatabaseAssertions.length).toBeGreaterThan(0);
    expect(capability.negativeCases.length).toBeGreaterThanOrEqual(4);
    for (const eventName of capability.requiredLogEvents) {
      expect(eventFor(eventName, actionType).eventName).toBe(eventName);
    }
    for (const grade of capability.requiredOutcomeGrades) {
      const outcome = resolveContest({
        actionType,
        actorScore: marginForGrade[grade],
        targetScore: 0,
        uncertaintyRange: 0,
        seed: `matrix:${actionType}:${grade}`,
      });
      expect(outcome.outcomeGrade).toBe(grade);
    }
  });

  it("collectively covers all six contest outcome grades", () => {
    const grades = new Set(
      selectedActions.flatMap(
        (actionType) => ACTION_CAPABILITIES[actionType].requiredOutcomeGrades,
      ),
    );
    for (const grade of ALL_OUTCOME_GRADES) {
      if (
        selectedActions.some((actionType) => ACTION_CAPABILITIES[actionType].resolver === "contest")
      ) {
        expect(grades.has(grade)).toBe(true);
      }
    }
  });
});
