import {
  ActionAffordanceEvaluationSchema,
  type ActionAffordanceEvaluation,
  type RelevanceCompiledContext,
  type SemanticActionFrame,
} from "@nocturne/contracts";

function factText(context: RelevanceCompiledContext) {
  return [...(context.playerKnownFacts ?? []), ...(context.authoritativeHiddenFacts ?? [])]
    .map(({ claim, value }) => `${claim}:${JSON.stringify(value)}`.toLowerCase())
    .join("\n");
}

function relevantFactIds(frame: SemanticActionFrame, context: RelevanceCompiledContext) {
  const ids = new Set([
    frame.actorId,
    ...frame.targetIds,
    ...frame.objectIds,
    ...frame.toolIds,
  ]);
  return [...(context.playerKnownFacts ?? []), ...(context.authoritativeHiddenFacts ?? [])]
    .filter((fact) => !fact.entityId || ids.has(fact.entityId))
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .map(({ factId }) => factId)
    .slice(0, 32);
}

function result(
  frame: SemanticActionFrame,
  context: RelevanceCompiledContext,
  input: Omit<ActionAffordanceEvaluation, "relevantFactIds">,
) {
  return ActionAffordanceEvaluationSchema.parse({
    ...input,
    relevantFactIds: relevantFactIds(frame, context),
  });
}

export function evaluateActionAffordance(
  frame: SemanticActionFrame,
  context: RelevanceCompiledContext,
): ActionAffordanceEvaluation {
  const entities = context.entities ?? [];
  const actor = entities.find(({ entityId }) => entityId === frame.actorId);
  if (!actor) {
    return result(frame, context, {
      status: "blocked",
      rationale: "The acting character is not present in the authoritative action context.",
      missingRequirements: ["authoritative actor state"],
      warnings: [],
    });
  }
  if (["destroyed", "retired", "merged", "dead"].includes(actor.lifecycleStatus.toLowerCase())) {
    return result(frame, context, {
      status: "blocked",
      rationale: `The acting character cannot act while lifecycle status is ${actor.lifecycleStatus}.`,
      missingRequirements: ["active actor lifecycle"],
      warnings: [],
    });
  }
  if (actor.condition !== undefined && actor.condition <= 0) {
    return result(frame, context, {
      status: "blocked",
      rationale:
        "The acting character has no remaining physical condition and cannot perform the action.",
      missingRequirements: ["positive physical condition"],
      warnings: [],
    });
  }

  const entityById = new Map(entities.map((entity) => [entity.entityId, entity]));
  const missingTargets = frame.targetIds.filter((id) => !entityById.has(id));
  if (missingTargets.length > 0) {
    return result(frame, context, {
      status: "clarification_required",
      rationale:
        "At least one referenced target is not established in the relevant authoritative context.",
      missingRequirements: missingTargets.map((id) => `resolvable target ${id}`),
      warnings: [],
    });
  }

  const remotelyActionable = frame.properties.movement || frame.properties.social;
  const unreachableTargets = frame.targetIds
    .map((id) => entityById.get(id))
    .filter((target) => Boolean(target))
    .filter(
      (target) =>
        !remotelyActionable &&
        actor.locationId !== null &&
        target!.locationId !== null &&
        actor.locationId !== target!.locationId,
    );
  if (unreachableTargets.length > 0) {
    return result(frame, context, {
      status: "blocked",
      rationale:
        "The requested target is not reachable from the actor's authoritative current location.",
      missingRequirements: unreachableTargets.map((target) => `reach ${target!.name}`),
      warnings: [],
    });
  }

  const facts = factText(context);
  if (/\b(?:unconscious|incapacitated|paralyzed)\b/.test(facts)) {
    return result(frame, context, {
      status: "blocked",
      rationale: "An authoritative incapacitating condition prevents voluntary action.",
      missingRequirements: ["conscious and mobile condition"],
      warnings: [],
    });
  }
  if (
    /\b(?:restrained|handcuffed|bound)\b/.test(facts) &&
    (frame.demands.physicalEffort > 1 || frame.demands.technicalComplexity > 0)
  ) {
    return result(frame, context, {
      status: "blocked",
      rationale:
        "The actor is authoritatively restrained and lacks the freedom of movement required.",
      missingRequirements: ["freedom of movement"],
      warnings: [],
    });
  }

  const missingTools = frame.toolIds.filter((id) => {
    const tool = entityById.get(id);
    return (
      !tool ||
      !tool.inclusionReasons.some((reason) =>
        ["owned", "controlled", "possessed"].includes(reason),
      )
    );
  });
  if (missingTools.length > 0) {
    return result(frame, context, {
      status: "blocked",
      rationale:
        "A required tool is not authoritatively possessed or controlled by the actor.",
      missingRequirements: missingTools.map((id) => `possess tool ${id}`),
      warnings: [],
    });
  }

  return result(frame, context, {
    status: "feasible",
    rationale:
      "The actor, relevant targets, location, and required controlled tools satisfy current affordance checks.",
    missingRequirements: [],
    warnings: [
      ...(frame.properties.destructive
        ? ["The action may permanently damage world state."]
        : []),
      ...(frame.properties.illegal
        ? ["The action may create legal, heat, or reputation consequences."]
        : []),
      ...(frame.demands.danger >= 5
        ? ["The action presents substantial physical danger."]
        : []),
    ],
  });
}
