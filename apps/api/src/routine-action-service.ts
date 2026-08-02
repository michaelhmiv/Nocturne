import type { SemanticActionFrame } from "@nocturne/contracts";
import type { UniversalOperationExecutor, WorldScope } from "@nocturne/database";

function narrationFor(frame: SemanticActionFrame) {
  if (frame.actionType === "exercise" && frame.quantity === 1) {
    return "You complete one push-up.";
  }
  if (frame.actionType === "exercise" && frame.quantity && frame.quantity > 1) {
    return `You complete ${frame.quantity} push-ups.`;
  }
  return `You complete the routine action: ${frame.objective}.`;
}

export function createRoutineActionService(executor: UniversalOperationExecutor) {
  async function execute(input: {
    scope: WorldScope;
    actorId: string;
    planId: string;
    stepId: string;
    idempotencyKey: string;
    frame: SemanticActionFrame;
  }) {
    const narration = narrationFor(input.frame);
    const receipt = await executor.execute({
      scope: input.scope,
      authority: "player",
      actorId: input.actorId,
      sourcePlanId: input.planId,
      sourceStepId: input.stepId,
      idempotencyKey: input.idempotencyKey,
      declaredFactIds: [],
      branch: {
        operations: [
          {
            type: "set_state_value",
            entityRef: { kind: "existing", entityId: input.actorId },
            path: ["activity", "last_routine_action"],
            value: {
              actionType: input.frame.actionType,
              objective: input.frame.objective,
              quantity: input.frame.quantity ?? null,
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
      outcomeGrade: "complete_success",
      eventId: receipt.eventId,
      receiptId: receipt.receiptId,
      narration,
    };
  }

  return { execute };
}

export type RoutineActionService = ReturnType<typeof createRoutineActionService>;
