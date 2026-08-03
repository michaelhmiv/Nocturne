import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { ActionResolutionDecision, SemanticActionFrame } from "@nocturne/contracts";
import type { UniversalOperationExecutionInput } from "@nocturne/database";
import { createTimedSemanticActionService } from "./timed-semantic-action-service.js";

const scope = {
  worldId: randomUUID(),
  shardId: randomUUID(),
  userId: "timed-test-user",
  role: "player" as const,
  selectedCharacterId: randomUUID(),
};

function frame(actorId: string): SemanticActionFrame {
  return {
    kind: "interact",
    actionType: "exercise",
    objective: "Exercise for 30 minutes",
    actorId,
    targetIds: [],
    objectIds: [],
    toolIds: [],
    durationSeconds: 1_800,
    references: [],
    claims: [
      {
        claimKey: "explicit_duration",
        claimType: "duration",
        sourceText: "Exercise for 30 minutes",
        normalizedValue: "1800 seconds",
        required: true,
        durationSeconds: 1_800,
      },
    ],
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
  };
}

const resolution: ActionResolutionDecision = {
  mode: "timed_task",
  rationale: "The action consumes meaningful world time.",
  meaningfulUncertainty: true,
  difficulty: 4,
  opposition: 0,
  consequenceLevel: 1,
  requiredFactIds: [],
};

describe("timed semantic action service", () => {
  it("creates a resumable schedule containing the authoritative frame", async () => {
    const actorId = randomUUID();
    const scheduleId = randomUUID();
    const execute = vi.fn(async (_input: UniversalOperationExecutionInput) => ({
      eventId: randomUUID(),
      receiptId: randomUUID(),
      symbolMap: { semantic_schedule: scheduleId },
    }));
    const service = createTimedSemanticActionService({ execute } as never);

    const result = await service.schedule({
      scope,
      actorId,
      planId: randomUUID(),
      stepId: randomUUID(),
      idempotencyKey: "timed:exercise",
      frame: frame(actorId),
      resolution,
      expectedVersions: { [actorId]: 3 },
    });
    const execution = execute.mock.calls[0]![0];
    const branch = execution.branch as { operations: unknown[] };

    expect(result.state).toBe("waiting");
    expect(result.scheduleId).toBe(scheduleId);
    expect(branch.operations).toEqual([
      expect.objectContaining({
        type: "schedule_timed_work",
        kind: "semantic_action_completion",
        durationSeconds: 1_800,
        expectedVersions: { [actorId]: 3 },
        payload: expect.objectContaining({
          actorId,
          frame: expect.objectContaining({
            objective: "Exercise for 30 minutes",
            claims: expect.arrayContaining([
              expect.objectContaining({ claimType: "duration", durationSeconds: 1_800 }),
            ]),
          }),
          resolution: expect.objectContaining({ mode: "timed_task" }),
        }),
      }),
    ]);
  });
});
