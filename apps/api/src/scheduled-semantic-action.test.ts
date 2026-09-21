import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScheduledWorkClaim, UniversalOperationExecutionInput } from "@nocturne/database";
import { createScheduledWorkService } from "./scheduled-work-service.js";

function claim(actorId: string): ScheduledWorkClaim {
  const worldId = randomUUID();
  const shardId = randomUUID();
  return {
    scheduleId: randomUUID(),
    worldId,
    shardId,
    idempotencyKey: "schedule:semantic",
    kind: "semantic_action_completion",
    payload: {
      userId: "scheduled-test-user",
      actorId,
      frame: {
        kind: "interact",
        actionType: "exercise",
        objective: "Exercise for 30 minutes",
        actorId,
        targetIds: [],
        objectIds: [],
        toolIds: [],
        durationSeconds: 1_800,
        properties: {
          selfDirected: true,
          opposed: false,
          destructive: false,
          illegal: false,
          social: false,
          movement: false,
          continuous: true,
        },
        demands: {
          physicalEffort: 4,
          technicalComplexity: 0,
          precision: 0,
          danger: 0,
          timePressure: 0,
        },
        assumptions: [],
        ambiguities: [],
      },
      resolution: {
        mode: "timed_task",
        rationale: "The action consumes meaningful world time.",
        meaningfulUncertainty: true,
        difficulty: 4,
        opposition: 0,
        consequenceLevel: 1,
        requiredFactIds: [],
      },
    },
    subjectEntityIds: [actorId],
    expectedVersions: {},
    resolutionPolicy: "scheduled-semantic-v1",
    planId: randomUUID(),
    stepId: randomUUID(),
    attemptNumber: 1,
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

afterEach(() => vi.useRealTimers());

describe("scheduled semantic action resolution", () => {
  it("commits completion and resumes the persistent plan", async () => {
    const actorId = randomUUID();
    const eventId = randomUUID();
    const receiptId = randomUUID();
    const execute = vi.fn(async (_input: UniversalOperationExecutionInput) => ({
      eventId,
      receiptId,
      symbolMap: {},
    }));
    const completeStep = vi.fn(async () => undefined);
    const satisfyExternalDependency = vi.fn(async () => undefined);
    const service = createScheduledWorkService({
      database: {} as never,
      executor: { execute } as never,
      plans: { completeStep, satisfyExternalDependency } as never,
      relationships: {} as never,
    });
    const work = claim(actorId);

    const result = await service.resolve(work);
    const execution = execute.mock.calls[0]![0];
    const branch = execution.branch as { operations: unknown[] };

    expect(result).toMatchObject({ eventId, receiptId });
    expect(branch.operations).toEqual([
      expect.objectContaining({
        type: "set_state_value",
        path: ["last_completed_timed_action"],
      }),
    ]);
    expect(completeStep).toHaveBeenCalledWith(
      expect.objectContaining({
        planId: work.planId,
        stepId: work.stepId,
        resultEventId: eventId,
        resultReceiptId: receiptId,
        scheduleId: work.scheduleId,
      }),
    );
    expect(satisfyExternalDependency).toHaveBeenCalledWith(
      expect.objectContaining({
        dependencyType: "after_time",
        eventId,
      }),
    );
  });

  it("uses byte-identical scheduled mutation payloads after worker retry and clock changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-21T18:00:00Z"));
    const actorId = randomUUID();
    const work = claim(actorId);
    const execute = vi.fn(async (_input: UniversalOperationExecutionInput) => ({
      eventId: randomUUID(),
      receiptId: randomUUID(),
      symbolMap: {},
    }));
    const service = createScheduledWorkService({
      database: {} as never,
      executor: { execute } as never,
      plans: { completeStep: vi.fn(), satisfyExternalDependency: vi.fn() } as never,
      relationships: {} as never,
    });
    await service.resolve(work);
    vi.setSystemTime(new Date("2026-09-21T18:05:00Z"));
    await service.resolve({ ...work, attemptNumber: 2 });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0]![0]).toEqual(execute.mock.calls[1]![0]);
    expect(JSON.stringify(execute.mock.calls[0]![0])).toContain(work.scheduleId);
    expect(JSON.stringify(execute.mock.calls[0]![0])).not.toContain("completedAt");
  });
});
