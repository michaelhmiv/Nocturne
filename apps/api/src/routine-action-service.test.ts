import { describe, expect, it, vi } from "vitest";
import {
  ActionResolutionDecisionSchema,
  SemanticActionFrameSchema,
} from "@nocturne/contracts";
import type { NonMutatingEventInput, WorldScope } from "@nocturne/database";
import { createRoutineActionService } from "./routine-action-service.js";

const actorId = "00000000-0000-4000-8000-000000000201";
const eventId = "00000000-0000-4000-8000-000000000202";
const receiptId = "00000000-0000-4000-8000-000000000203";

const scope: WorldScope = {
  worldId: "00000000-0000-4000-8000-000000000001",
  shardId: "00000000-0000-4000-8000-000000000002",
  userId: "routine-test-user",
  role: "player",
  selectedCharacterId: actorId,
};

const frame = SemanticActionFrameSchema.parse({
  kind: "interact",
  actionType: "exercise",
  objective: "Do a push-up",
  actorId,
  targetIds: [actorId],
  objectIds: [],
  toolIds: [],
  quantity: 1,
  references: [],
  claims: [],
  properties: {
    selfDirected: true,
    opposed: false,
    destructive: false,
    illegal: false,
    social: false,
    movement: false,
    continuous: false,
  },
  demands: {
    physicalEffort: 1,
    technicalComplexity: 0,
    precision: 0,
    danger: 0,
    timePressure: 0,
  },
  assumptions: [],
  ambiguities: [],
});

function resolution(mode: "automatic_success" | "automatic_failure") {
  return ActionResolutionDecisionSchema.parse({
    mode,
    rationale:
      mode === "automatic_success"
        ? "The action has no meaningful uncertainty."
        : "A prerequisite is missing.",
    meaningfulUncertainty: false,
    difficulty: 0,
    opposition: 0,
    consequenceLevel: 0,
    requiredFactIds: [],
  });
}

function harness() {
  const record = vi.fn(async (input: NonMutatingEventInput) => ({
    eventId,
    receiptId,
    eventType: input.eventType,
    idempotentReplay: false as const,
  }));
  return { record, service: createRoutineActionService({ record }) };
}

describe("routine action service", () => {
  it("records a successful routine action without inventing a character-state mutation", async () => {
    const { record, service } = harness();

    const outcome = await service.execute({
      scope,
      actorId,
      planId: "00000000-0000-4000-8000-000000000204",
      stepId: "00000000-0000-4000-8000-000000000205",
      idempotencyKey: "routine-success",
      frame,
      resolution: resolution("automatic_success"),
    });

    expect(record).toHaveBeenCalledOnce();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        scope,
        actorId,
        idempotencyKey: "routine-success",
        eventType: "action_completed_non_mutating",
        playerVisibleFacts: ["You complete one push-up."],
        hiddenFacts: [],
        payload: expect.objectContaining({
          actionType: "exercise",
          objective: "Do a push-up",
          quantity: 1,
          resolutionMode: "automatic_success",
        }),
      }),
    );
    expect(outcome).toEqual({
      state: "completed",
      outcomeGrade: "complete_success",
      eventId,
      receiptId,
      narration: "You complete one push-up.",
    });
  });

  it("records an automatic failure as an action_failed event", async () => {
    const { record, service } = harness();

    const outcome = await service.execute({
      scope,
      actorId,
      planId: "00000000-0000-4000-8000-000000000206",
      stepId: "00000000-0000-4000-8000-000000000207",
      idempotencyKey: "routine-failure",
      frame,
      resolution: resolution("automatic_failure"),
    });

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "action_failed",
        idempotencyKey: "routine-failure",
      }),
    );
    expect(outcome.outcomeGrade).toBe("failure");
    expect(outcome.narration).toContain("A prerequisite is missing.");
  });

  it("rejects non-routine resolution modes before writing an event", async () => {
    const { record, service } = harness();
    const uncertain = ActionResolutionDecisionSchema.parse({
      mode: "unopposed_check",
      rationale: "The outcome is uncertain.",
      meaningfulUncertainty: true,
      difficulty: 4,
      opposition: 0,
      consequenceLevel: 2,
      requiredFactIds: [],
    });

    await expect(
      service.execute({
        scope,
        actorId,
        planId: "00000000-0000-4000-8000-000000000208",
        stepId: "00000000-0000-4000-8000-000000000209",
        idempotencyKey: "routine-invalid-mode",
        frame,
        resolution: uncertain,
      }),
    ).rejects.toThrow("Routine action service cannot execute unopposed_check.");
    expect(record).not.toHaveBeenCalled();
  });
});
