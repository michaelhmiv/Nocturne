import type {
  ActionResolutionDecision,
  SemanticActionFrame,
} from "@nocturne/contracts";
import type { UniversalOperationExecutor, WorldScope } from "@nocturne/database";

function successNarration(frame: SemanticActionFrame) {
  if (frame.actionType === "exercise" && frame.quantity === 1) {
    return "You complete one push-up.";
  }
  if (frame.actionType === "exercise" && frame.quantity && frame.quantity > 1) {
    return `You complete ${frame.quantity} push-ups.`;
  }
  return `You complete the routine action: ${frame.objective}.`;
}

function failureNarration(frame: SemanticActionFrame, resolution: ActionResolutionDecision) {
  return `You cannot complete that action: ${resolution.rationale}`;
}

export function createRoutineActionService(executor: UniversalOperationExecutor) {
  async function execute(input: {
    scope: WorldScope;
    actorId: string;
    planId: string;
    stepId: string;
    idempotencyKey: string;
    frame: SemanticActionFrame;
    resolution: ActionResolutionDecision;
  }) {
    if (!['automatic_success', 'automatic_failure'].includes(input.resolution.mode)) {
      throw new Error(`Routine action service cannot execute ${input.resolution.mode}.`);
    }
    const succeeded = input.resolution.mode === "automatic_success";
    const narration = succeeded
      ? successNarration(input.frame)
      : failureNarration(input.frame, input.resolution);
    const receipt = await executor.execute({
      scope: input.scope,
      authority: "player",
      actorId: input.actorId,
      sourcePlanId: input.planId,
      sourceStepId: input.stepId,
      idempotencyKey: input.idempotencyKey,
      declaredFactIds: input.resolution.requiredFactIds,
      branch: {
        operations: [
          {
            type: "set_state_value",
            entityRef: { kind: "existing", entityId: input.actorId },
            path: ["activity", "last_deterministic_action"],
            value: {
              actionType: input.frame.actionType,
              objective: input.frame.objective,
              quantity: input.frame.quantity ?? null,
              resolutionMode: input.resolution.mode,
              rationale: input.resolution.rationale,
              occurredAt: new Date().toISOString(),
            },
            preconditionFactIds: [],
          },
        ],
      },
      playerVisibleFacts: [narration],
      hiddenFacts: [],
    });
    return {
      state: "completed" as const,
      outcomeGrade: succeeded ? "complete_success" : "failure",
      eventId: receipt.eventId,
      receiptId: receipt.receiptId,
      narration,
    };
  }

  return { execute };
}

export type RoutineActionService = ReturnType<typeof createRoutineActionService>;
