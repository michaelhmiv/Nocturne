import { createHmac } from "node:crypto";
import type {
  ActionResolutionDecision,
  RelevanceCompiledContext,
  SemanticActionFrame,
  UniversalWorldOperation,
} from "@nocturne/contracts";
import type { UniversalOperationExecutor, WorldScope } from "@nocturne/database";

function deterministicRoll(secret: string | Buffer, idempotencyKey: string) {
  const digest = createHmac("sha256", secret).update(idempotencyKey).digest();
  return digest.readUInt32BE(0) % 10;
}

function actorCondition(context: RelevanceCompiledContext, actorId: string) {
  return (context.entities ?? []).find(({ entityId }) => entityId === actorId)?.condition ?? 100;
}

function successFor(
  frame: SemanticActionFrame,
  resolution: ActionResolutionDecision,
  context: RelevanceCompiledContext,
  roll: number,
) {
  if (["conversation", "transaction"].includes(resolution.mode)) return true;
  if (resolution.mode === "unopposed_check") {
    const capability = Math.round(actorCondition(context, frame.actorId) / 20);
    return capability + roll >= resolution.difficulty;
  }
  if (resolution.mode === "opposed_contest") {
    const capability = Math.round(actorCondition(context, frame.actorId) / 20);
    return capability + roll >= resolution.difficulty + resolution.opposition;
  }
  return resolution.mode === "automatic_success";
}

function narration(
  frame: SemanticActionFrame,
  resolution: ActionResolutionDecision,
  succeeded: boolean,
) {
  if (resolution.mode === "clarification_required") {
    return `Clarification required before acting: ${resolution.rationale}`;
  }
  if (succeeded) return `You accomplish your objective: ${frame.objective}.`;
  return `You attempt the action but do not accomplish the objective: ${frame.objective}.`;
}

function operations(input: {
  frame: SemanticActionFrame;
  resolution: ActionResolutionDecision;
  succeeded: boolean;
  roll: number;
}): UniversalWorldOperation[] {
  const result: UniversalWorldOperation[] = [
    {
      type: "set_state_value",
      entityRef: { kind: "existing", entityId: input.frame.actorId },
      path: ["activity", "last_semantic_action"],
      value: {
        actionType: input.frame.actionType,
        objective: input.frame.objective,
        resolutionMode: input.resolution.mode,
        succeeded: input.succeeded,
        needsClarification: input.resolution.mode === "clarification_required",
        rationale: input.resolution.rationale,
        roll: input.roll,
        occurredAt: new Date().toISOString(),
      },
      preconditionFactIds: [],
    },
  ];

  const targetId = input.frame.targetIds[0];
  if (input.succeeded && input.frame.kind === "combat" && targetId) {
    result.push({
      type: "adjust_condition",
      entityRef: { kind: "existing", entityId: targetId },
      delta: -Math.max(1, Math.min(25, input.resolution.difficulty + 5)),
      preconditionFactIds: [],
    });
  }
  if (input.succeeded && input.frame.kind === "relationship" && targetId) {
    result.push({
      type: "set_relation",
      sourceRef: { kind: "existing", entityId: input.frame.actorId },
      targetRef: { kind: "existing", entityId: targetId },
      relationType: "social_interaction",
      parameters: {
        actionType: input.frame.actionType,
        objective: input.frame.objective,
      },
      preconditionFactIds: [],
    });
  }
  const objectId = input.frame.objectIds[0];
  if (input.succeeded && input.frame.kind === "transfer" && objectId && targetId) {
    result.push({
      type: "transfer_possession",
      entityRef: { kind: "existing", entityId: objectId },
      possessorRef: { kind: "existing", entityId: targetId },
      preconditionFactIds: [],
    });
  }
  if (input.succeeded && input.frame.kind === "question") {
    result.push({
      type: "create_information_asset",
      holderRef: { kind: "existing", entityId: input.frame.actorId },
      ...(targetId ? { subjectRef: { kind: "existing" as const, entityId: targetId } } : {}),
      content: `The actor asked: ${input.frame.objective}`,
      confidenceBasisPoints: 5_000,
      truthStatus: "observation",
      preconditionFactIds: [],
    });
  }
  return result;
}

export function createSemanticActionExecutionService(input: {
  executor: UniversalOperationExecutor;
  rollSecret: string | Buffer;
}) {
  async function execute(request: {
    scope: WorldScope;
    actorId: string;
    planId: string;
    stepId: string;
    idempotencyKey: string;
    frame: SemanticActionFrame;
    resolution: ActionResolutionDecision;
    context: RelevanceCompiledContext;
  }) {
    if (
      ![
        "automatic_success",
        "automatic_failure",
        "clarification_required",
        "unopposed_check",
        "opposed_contest",
        "transaction",
        "conversation",
      ].includes(request.resolution.mode)
    ) {
      throw new Error(`Semantic executor cannot execute ${request.resolution.mode}.`);
    }
    const roll = deterministicRoll(input.rollSecret, request.idempotencyKey);
    const succeeded =
      request.resolution.mode !== "automatic_failure" &&
      request.resolution.mode !== "clarification_required" &&
      successFor(request.frame, request.resolution, request.context, roll);
    const playerNarration = narration(request.frame, request.resolution, succeeded);
    const receipt = await input.executor.execute({
      scope: request.scope,
      authority: "player",
      actorId: request.actorId,
      sourcePlanId: request.planId,
      sourceStepId: request.stepId,
      idempotencyKey: request.idempotencyKey,
      declaredFactIds: request.resolution.requiredFactIds,
      branch: {
        operations: operations({
          frame: request.frame,
          resolution: request.resolution,
          succeeded,
          roll,
        }),
      },
      playerVisibleFacts: [playerNarration],
      hiddenFacts: [],
    });
    return {
      state: "completed" as const,
      outcomeGrade: succeeded ? "complete_success" : "failure",
      eventId: receipt.eventId,
      receiptId: receipt.receiptId,
      narration: playerNarration,
    };
  }

  return { execute };
}

export type SemanticActionExecutionService = ReturnType<
  typeof createSemanticActionExecutionService
>;
