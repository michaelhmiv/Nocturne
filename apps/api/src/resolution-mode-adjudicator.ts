import {
  ActionResolutionDecisionSchema,
  type ActionResolutionDecision,
  type RelevanceCompiledContext,
  type SemanticActionFrame,
} from "@nocturne/contracts";
import { evaluateActionAffordance } from "./action-affordance-evaluator.js";
import { isRoutineSelfDirectedAction } from "./semantic-action-frame.js";

const impossibleWithoutSupport = [
  /\b(?:fly|levitate)\b.*\b(?:without|no)\b.*\b(?:wings?|equipment|power)\b/i,
  /\b(?:breathe|live)\b.*\bunderwater\b.*\bunaided\b/i,
  /\b(?:walk|phase|pass)\b.*\bthrough\b.*\b(?:solid )?wall\b/i,
  /\bteleport\b/i,
  /\blift\b.*\b(?:building|skyscraper|mountain)\b/i,
];

function relevantFactIds(frame: SemanticActionFrame, context?: RelevanceCompiledContext) {
  if (!context) return [];
  const entities = new Set([
    frame.actorId,
    ...frame.targetIds,
    ...frame.objectIds,
    ...frame.toolIds,
  ]);
  return (context.playerKnownFacts ?? [])
    .filter((fact) => !fact.entityId || entities.has(fact.entityId))
    .map(({ factId }) => factId)
    .slice(0, 32);
}

function hasExtraordinarySupport(frame: SemanticActionFrame, context?: RelevanceCompiledContext) {
  if (!context) return false;
  const text = JSON.stringify([
    frame.assumptions,
    ...(context.playerKnownFacts ?? []).map(({ claim, value }) => [claim, value]),
  ]).toLowerCase();
  return /\b(?:power|superhuman|flight|teleportation|phasing|gills|exoskeleton|powered armor)\b/.test(
    text,
  );
}

function decision(
  frame: SemanticActionFrame,
  input: Omit<ActionResolutionDecision, "requiredFactIds">,
  context?: RelevanceCompiledContext,
) {
  return ActionResolutionDecisionSchema.parse({
    ...input,
    requiredFactIds: relevantFactIds(frame, context),
  });
}

export function adjudicateActionResolution(
  frame: SemanticActionFrame,
  context?: RelevanceCompiledContext,
): ActionResolutionDecision {
  const demand = Math.max(
    frame.demands.physicalEffort,
    frame.demands.technicalComplexity,
    frame.demands.precision,
    frame.demands.danger,
    frame.demands.timePressure,
  );
  const consequences = Math.min(
    10,
    Math.max(
      frame.demands.danger,
      frame.properties.destructive ? 5 : 0,
      frame.properties.illegal ? 4 : 0,
    ),
  );
  const opposition = frame.properties.opposed
    ? Math.min(10, Math.max(3, frame.targetIds.length + 2))
    : 0;

  if (context?.entities) {
    const affordance = evaluateActionAffordance(frame, context);
    if (affordance.status === "blocked") {
      return ActionResolutionDecisionSchema.parse({
        mode: "automatic_failure",
        rationale: affordance.rationale,
        meaningfulUncertainty: false,
        difficulty: demand,
        opposition: 0,
        consequenceLevel: consequences,
        requiredFactIds: affordance.relevantFactIds,
      });
    }
    if (affordance.status === "clarification_required") {
      return ActionResolutionDecisionSchema.parse({
        mode: "clarification_required",
        rationale: affordance.rationale,
        meaningfulUncertainty: false,
        difficulty: demand,
        opposition,
        consequenceLevel: consequences,
        requiredFactIds: affordance.relevantFactIds,
      });
    }
  }

  if (frame.ambiguities.length > 0) {
    return decision(
      frame,
      {
        mode: "clarification_required",
        rationale: `Material ambiguity remains: ${frame.ambiguities.join("; ")}`,
        meaningfulUncertainty: false,
        difficulty: demand,
        opposition,
        consequenceLevel: consequences,
      },
      context,
    );
  }

  if (frame.properties.movement) {
    return decision(
      frame,
      {
        mode: "movement",
        rationale: "Authoritative location change must use the movement and routing subsystem.",
        meaningfulUncertainty: false,
        difficulty: demand,
        opposition: 0,
        consequenceLevel: consequences,
      },
      context,
    );
  }

  if (["dialogue", "question"].includes(frame.kind) && !frame.properties.opposed) {
    return decision(
      frame,
      {
        mode: "conversation",
        rationale:
          "The action is communicative and does not itself compel a resisted state change.",
        meaningfulUncertainty: false,
        difficulty: demand,
        opposition: 0,
        consequenceLevel: consequences,
      },
      context,
    );
  }

  if (frame.kind === "transfer" && !frame.properties.illegal && !frame.properties.opposed) {
    return decision(
      frame,
      {
        mode: "transaction",
        rationale:
          "A consensual transfer should validate ownership, price, and atomic exchange without a random roll.",
        meaningfulUncertainty: false,
        difficulty: demand,
        opposition: 0,
        consequenceLevel: consequences,
      },
      context,
    );
  }

  if (
    impossibleWithoutSupport.some((pattern) => pattern.test(frame.objective)) &&
    !hasExtraordinarySupport(frame, context)
  ) {
    return decision(
      frame,
      {
        mode: "automatic_failure",
        rationale:
          "The requested action contradicts ordinary physical constraints and no supporting capability is established.",
        meaningfulUncertainty: false,
        difficulty: 10,
        opposition: 0,
        consequenceLevel: consequences,
      },
      context,
    );
  }

  if (frame.properties.continuous || (frame.durationSeconds ?? 0) > 30) {
    return decision(
      frame,
      {
        mode: "timed_task",
        rationale:
          "The action consumes meaningful world time and must be represented as interruptible scheduled work.",
        meaningfulUncertainty: demand > 2,
        difficulty: demand,
        opposition,
        consequenceLevel: consequences,
      },
      context,
    );
  }

  if (frame.properties.opposed) {
    return decision(
      frame,
      {
        mode: "opposed_contest",
        rationale: "Another entity actively resists or materially determines the outcome.",
        meaningfulUncertainty: true,
        difficulty: demand,
        opposition,
        consequenceLevel: consequences,
      },
      context,
    );
  }

  if (isRoutineSelfDirectedAction(frame) || demand <= 2) {
    return decision(
      frame,
      {
        mode: "automatic_success",
        rationale:
          "The action is feasible, routine, unopposed, and carries no meaningful uncertainty.",
        meaningfulUncertainty: false,
        difficulty: demand,
        opposition: 0,
        consequenceLevel: consequences,
      },
      context,
    );
  }

  return decision(
    frame,
    {
      mode: "unopposed_check",
      rationale:
        "The action is possible but demanding enough that skill, condition, or environment can materially change the result.",
      meaningfulUncertainty: true,
      difficulty: demand,
      opposition: 0,
      consequenceLevel: consequences,
    },
    context,
  );
}
