import {
  ActionAffordanceEvaluationSchema,
  type ActionAffordanceEvaluation,
  type RelevanceCompiledContext,
  type SemanticActionFrame,
} from "@nocturne/contracts";

const possessionPrefix = "requires_possession:";
const possessionReasons = new Set(["owned", "controlled", "possessed"]);
const ignoredNameTokens = new Set([
  "a",
  "an",
  "the",
  "my",
  "some",
  "pair",
  "set",
  "of",
  "item",
  "items",
]);
const intrinsicAnatomyModifiers = new Set([
  "bare",
  "open",
  "closed",
  "left",
  "right",
  "own",
]);
const intrinsicAnatomyTokens = new Set([
  "ankle",
  "arm",
  "back",
  "body",
  "cheek",
  "chest",
  "chin",
  "ear",
  "elbow",
  "eye",
  "face",
  "finger",
  "fingertip",
  "fist",
  "foot",
  "forearm",
  "forehead",
  "hand",
  "head",
  "heel",
  "hip",
  "knee",
  "knuckle",
  "leg",
  "mouth",
  "neck",
  "nose",
  "palm",
  "shoulder",
  "skin",
  "thumb",
  "toe",
  "tongue",
  "torso",
  "wrist",
]);

function factText(context: RelevanceCompiledContext) {
  return [...(context.playerKnownFacts ?? []), ...(context.authoritativeHiddenFacts ?? [])]
    .map(({ claim, value }) => `${claim}:${JSON.stringify(value)}`.toLowerCase())
    .join("\n");
}

function relevantFactIds(frame: SemanticActionFrame, context: RelevanceCompiledContext) {
  const typedReferenceIds = (frame.references ?? [])
    .map((reference) => reference.resolvedEntityId)
    .filter((id): id is string => Boolean(id));
  const ids = new Set([
    frame.actorId,
    ...frame.targetIds,
    ...frame.objectIds,
    ...frame.toolIds,
    ...typedReferenceIds,
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

function tokenVariants(token: string) {
  const variants = new Set([token]);
  if (token.endsWith("ies") && token.length > 3) variants.add(`${token.slice(0, -3)}y`);
  if (token.endsWith("ves") && token.length > 3) {
    variants.add(`${token.slice(0, -3)}f`);
    variants.add(`${token.slice(0, -3)}fe`);
  }
  if (token.endsWith("s") && !token.endsWith("ss") && token.length > 3) {
    variants.add(token.slice(0, -1));
  }
  return variants;
}

function nameTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9' -]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !ignoredNameTokens.has(token));
}

function nameMatches(requirement: string, entityName: string) {
  const required = nameTokens(requirement);
  const available = new Set(nameTokens(entityName).flatMap((token) => [...tokenVariants(token)]));
  return (
    required.length > 0 &&
    required.every((token) => [...tokenVariants(token)].some((variant) => available.has(variant)))
  );
}

function isIntrinsicAnatomyRequirement(requirement: string) {
  const tokens = nameTokens(requirement).filter((token) => !intrinsicAnatomyModifiers.has(token));
  return (
    tokens.length > 0 &&
    tokens.every((token) =>
      [...tokenVariants(token)].some((variant) => intrinsicAnatomyTokens.has(variant)),
    )
  );
}

function possessionRequirements(frame: SemanticActionFrame) {
  const typed = (frame.claims ?? [])
    .filter((claim) => claim.claimType === "possession" && claim.required)
    .map((claim) => claim.normalizedValue.trim())
    .filter(Boolean);
  const legacy = frame.assumptions
    .filter((assumption) => assumption.startsWith(possessionPrefix))
    .map((assumption) => assumption.slice(possessionPrefix.length).trim())
    .filter(Boolean);
  return [...new Set([...typed, ...legacy])].filter(
    (requirement) => !isIntrinsicAnatomyRequirement(requirement),
  );
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

  const controlledEntities = entities.filter((entity) =>
    entity.inclusionReasons.some((reason) => possessionReasons.has(reason)),
  );
  const missingPossessions = possessionRequirements(frame).filter(
    (requirement) => !controlledEntities.some((entity) => nameMatches(requirement, entity.name)),
  );
  if (missingPossessions.length > 0) {
    return result(frame, context, {
      status: "blocked",
      rationale:
        "The attempted action requires an item that is not authoritatively owned, controlled, or carried by the actor.",
      missingRequirements: missingPossessions.map((name) => `possess ${name}`),
      warnings: [],
    });
  }

  const entityById = new Map(entities.map((entity) => [entity.entityId, entity]));
  const referencedIds = [...frame.targetIds, ...frame.objectIds, ...frame.toolIds];
  const missingReferences = referencedIds.filter((id) => !entityById.has(id));
  if (missingReferences.length > 0) {
    return result(frame, context, {
      status: "clarification_required",
      rationale:
        "At least one referenced entity is not established in the relevant authoritative context.",
      missingRequirements: missingReferences.map((id) => `resolvable entity ${id}`),
      warnings: [],
    });
  }

  const unresolvedTypedReferences = (frame.references ?? []).filter(
    (reference) =>
      reference.required &&
      reference.relationship !== "possessed" &&
      reference.resolution !== "resolved_entity" &&
      reference.resolution !== "resolved_intrinsic",
  );
  if (unresolvedTypedReferences.length > 0) {
    const clarificationReferences = unresolvedTypedReferences.filter(
      (reference) => reference.allowClarification || reference.resolution === "ambiguous",
    );
    return result(frame, context, {
      status: clarificationReferences.length > 0 ? "clarification_required" : "blocked",
      rationale:
        clarificationReferences.length > 0
          ? "A required reference remains ambiguous or unresolved after authoritative context resolution."
          : "A required non-clarifiable reference is unavailable in authoritative state.",
      missingRequirements: unresolvedTypedReferences.map(
        (reference) => `resolve ${reference.normalizedText}`,
      ),
      warnings: [],
    });
  }

  const remotelyActionable = frame.properties.movement || frame.properties.social;
  const physicallyReferencedIds = [...frame.targetIds, ...frame.objectIds];
  const unreachableEntities = physicallyReferencedIds
    .map((id) => entityById.get(id))
    .filter((entity) => Boolean(entity))
    .filter(
      (entity) =>
        !remotelyActionable &&
        actor.locationId !== null &&
        entity!.locationId !== null &&
        actor.locationId !== entity!.locationId,
    );
  if (unreachableEntities.length > 0) {
    return result(frame, context, {
      status: "blocked",
      rationale:
        "A referenced entity is not reachable from the actor's authoritative current location.",
      missingRequirements: unreachableEntities.map((entity) => `reach ${entity!.name}`),
      warnings: [],
    });
  }

  const missingTools = frame.toolIds.filter((id) => {
    const tool = entityById.get(id);
    return !tool || !tool.inclusionReasons.some((reason) => possessionReasons.has(reason));
  });
  if (missingTools.length > 0) {
    return result(frame, context, {
      status: "blocked",
      rationale: "A required tool is not authoritatively possessed or controlled by the actor.",
      missingRequirements: missingTools.map((id) => `possess tool ${id}`),
      warnings: [],
    });
  }

  return result(frame, context, {
    status: "feasible",
    rationale:
      "The actor, relevant entities, location, and required controlled tools satisfy current affordance checks.",
    missingRequirements: [],
    warnings: [
      ...(frame.properties.destructive ? ["The action may permanently damage world state."] : []),
      ...(frame.properties.illegal
        ? ["The action may create legal, heat, or reputation consequences."]
        : []),
      ...(frame.demands.danger >= 5 ? ["The action presents substantial physical danger."] : []),
    ],
  });
}
