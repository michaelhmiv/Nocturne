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

type HazardEffect = {
  conditionDelta: number;
  condition: "self_inflicted_injury" | "action_injury";
  intensity: number;
  durationSeconds: number;
};

function hazardEffect(
  frame: SemanticActionFrame,
  resolution: ActionResolutionDecision,
  succeeded: boolean,
): HazardEffect | null {
  if (
    frame.demands.danger < 3 ||
    ["automatic_failure", "clarification_required", "conversation", "transaction"].includes(
      resolution.mode,
    )
  ) {
    return null;
  }
  if (!frame.properties.selfDirected && succeeded) return null;
  const severity = Math.max(
    1,
    Math.min(25, Math.max(frame.demands.danger, resolution.consequenceLevel)),
  );
  const conditionLoss = frame.properties.selfDirected ? severity : Math.max(1, Math.ceil(severity / 2));
  return {
    conditionDelta: -conditionLoss,
    condition: frame.properties.selfDirected ? "self_inflicted_injury" : "action_injury",
    intensity: Math.min(100, severity * 10),
    durationSeconds: Math.max(300, severity * 300),
  };
}

function narration(
  frame: SemanticActionFrame,
  resolution: ActionResolutionDecision,
  succeeded: boolean,
  hazard: HazardEffect | null,
) {
  if (resolution.mode === "clarification_required") {
    return `Clarification required before acting: ${resolution.rationale}`;
  }
  const base = succeeded
    ? `You accomplish your objective: ${frame.objective}.`
    : `You attempt the action but do not accomplish the objective: ${frame.objective}.`;
  if (!hazard) return base;
  return `${base} The attempt causes a physical injury and costs ${Math.abs(
    hazard.conditionDelta,
  )} condition.`;
}

function operations(input: {
  frame: SemanticActionFrame;
  resolution: ActionResolutionDecision;
  succeeded: boolean;
  roll: number;
  hazard: HazardEffect | null;
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
        hazard: input.hazard,
        occurredAt: new Date().toISOString(),
      },
      preconditionFactIds: [],
    },
  ];

  if (input.hazard) {
    result.push(
      {
        type: "adjust_condition",
        entityRef: { kind: "existing", entityId: input.frame.actorId },
        delta: input.hazard.conditionDelta,
        preconditionFactIds: [],
      },
      {
        type: "set_condition",
        entityRef: { kind: "existing", entityId: input.frame.actorId },
        condition: input.hazard.condition,
        active: true,
        intensity: input.hazard.intensity,
        durationSeconds: input.hazard.durationSeconds,
        metadata: {
          actionType: input.frame.actionType,
          objective: input.frame.objective,
          resolutionMode: input.resolution.mode,
        },
        preconditionFactIds: [],
      },
    );
  }

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
    const hazard = hazardEffect(request.frame, request.resolution, succeeded);
    const playerNarration = narration(request.frame, request.resolution, succeeded, hazard);
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
          hazard,
        }),
      },
      playerVisibleFacts: [playerNarration],
      hiddenFacts: [],
    });
    return {
      state: "completed" as const,
      outcomeGrade: succeeded
        ? hazard
          ? "success_with_consequence"
          : "complete_success"
        : "failure",
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
