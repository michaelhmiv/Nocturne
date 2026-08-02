import type { ActionResolutionDecision, SemanticActionFrame } from "@nocturne/contracts";
import type { UniversalOperationExecutor, WorldScope } from "@nocturne/database";

export function createTimedSemanticActionService(executor: UniversalOperationExecutor) {
  async function schedule(input: {
    scope: WorldScope;
    actorId: string;
    planId: string;
    stepId: string;
    idempotencyKey: string;
    frame: SemanticActionFrame;
    resolution: ActionResolutionDecision;
    expectedVersions: Record<string, number>;
  }) {
    if (input.resolution.mode !== "timed_task") {
      throw new Error(`Timed semantic action service cannot schedule ${input.resolution.mode}.`);
    }
    const durationSeconds = Math.max(
      1,
      input.frame.durationSeconds ?? Math.max(30, input.resolution.difficulty * 30),
    );
    const symbol = "semantic_schedule";
    const receipt = await executor.execute({
      scope: input.scope,
      authority: "player",
      actorId: input.actorId,
      sourcePlanId: input.planId,
      sourceStepId: input.stepId,
      idempotencyKey: `${input.idempotencyKey}:schedule`,
      declaredFactIds: input.resolution.requiredFactIds,
      branch: {
        operations: [
          {
            type: "schedule_timed_work",
            symbol,
            kind: "semantic_action_completion",
            subjectRefs: [
              { kind: "existing", entityId: input.actorId },
              ...input.frame.targetIds.map((entityId) => ({
                kind: "existing" as const,
                entityId,
              })),
              ...input.frame.objectIds.map((entityId) => ({
                kind: "existing" as const,
                entityId,
              })),
            ],
            description: input.frame.objective,
            durationSeconds,
            payload: {
              userId: input.scope.userId,
              actorId: input.actorId,
              frame: input.frame,
              resolution: input.resolution,
            },
            expectedVersions: input.expectedVersions,
            preconditionFactIds: input.resolution.requiredFactIds,
          },
        ],
      },
      playerVisibleFacts: [
        `You begin ${input.frame.objective}. Estimated completion: ${durationSeconds} seconds.`,
      ],
      hiddenFacts: [],
    });
    const scheduleId = receipt.symbolMap[symbol];
    if (!scheduleId) throw new Error("Semantic action schedule was not created.");
    return {
      state: "waiting" as const,
      planStatus: "waiting_for_time" as const,
      reason: `The action is in progress for ${durationSeconds} seconds.`,
      narration: `You begin ${input.frame.objective}. Estimated completion: ${durationSeconds} seconds.`,
      scheduleId,
    };
  }

  return { schedule };
}

export type TimedSemanticActionService = ReturnType<typeof createTimedSemanticActionService>;
