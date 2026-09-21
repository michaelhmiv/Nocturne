import {
  EntityReferenceInterpretationSchema,
  WorldActionKindSchema,
  type EntityReferenceCandidate,
  type EntityReferenceInterpretation,
  type PersistentActionPlanProposal,
  type RelevanceCompiledContext,
  type WorldActionKind,
} from "@nocturne/contracts";
import {
  requireDecisionChoice,
  requireDecisionNoul,
  type AiDecisionClient,
  type DecisionChoiceQuestion,
  type DecisionNoulQuestion,
} from "./decision-client.js";

const MAX_DECISION_CANDIDATES = 12;
const MIN_KIND_CONFIDENCE = 0.65;
const REFERENCE_RESOLVE_THRESHOLD = 0.72;
const REMOTE_REFERENCE_RESOLVE_THRESHOLD = 0.95;
const REFERENCE_AMBIGUOUS_THRESHOLD = 0.55;
const REFERENCE_DOMINANCE_GAP = 0.15;
const CLARIFICATION_THRESHOLD = 0.65;
const MULTI_STEP_THRESHOLD = 0.5;
type PlanReferenceRole =
  "target" | "location" | "method" | "resource" | "companion" | "vehicle" | "container" | "other";
type CandidateReferenceRole = PlanReferenceRole | "none";

const referenceRoleCriteria: Record<CandidateReferenceRole, string> = {
  none: "The player's command does not materially refer to this candidate.",
  target:
    "The candidate is the direct person/object acted upon, spoken to, attacked, inspected, bought, sold, taken, or otherwise targeted.",
  location:
    "The candidate is the destination, searched area, current place reference, or other location central to the action.",
  method:
    "The candidate is a tool, weapon, instrument, method, or item explicitly used to perform the action.",
  resource:
    "The candidate is a substance, item, money-like resource, or transferable thing consumed, acquired, sold, given, or spent.",
  companion:
    "The candidate is a person or entity accompanying/following the actor rather than the direct target.",
  vehicle: "The candidate is the vehicle used for travel or transport.",
  container:
    "The candidate is a container that something is put into, removed from, opened, or searched within.",
  other: "The candidate is materially referenced but none of the more specific supplied roles fit.",
};

const actionTypeCriteria = {
  detect: "Actively scan or check for hidden threats, surveillance, danger, or signs of presence.",
  move: "Move on foot or otherwise relocate without specifically operating a vehicle.",
  search:
    "Search an area for a requested person, item, evidence, resource, entrance, or other concept.",
  talk: "Speak, ask, converse, call, message, or otherwise communicate normally.",
  attack: "Physically attack, strike, punch, fight, or injure a target.",
  steal: "Take property without permission or otherwise commit theft.",
  pick_up: "Pick up or take possession of an available item without implying theft.",
  give: "Give or hand an item/resource to another person or entity.",
  transfer:
    "Transfer possession of an item/resource to another person or entity without implying a sale.",
  put_in:
    "Place an item into or onto a specified container or destination without implying abandonment or sale.",
  drop: "Relinquish possession of an item at the actor's current place.",
  sneak: "Move stealthily or quietly to avoid detection.",
  lockpick: "Manipulate a mechanical lock to open it without the normal key.",
  hack: "Bypass, manipulate, or access an electronic/computer security system.",
  heal: "Treat an injury or condition with first aid or medical action.",
  consume: "Eat, drink, swallow, ingest, inhale, inject, or otherwise consume a substance.",
  craft: "Build, make, assemble, repair, or fabricate an item or structure.",
  drive: "Travel by operating or riding in a vehicle.",
  bribe: "Offer money or value to influence another person's behavior.",
  persuade: "Convince another person through non-threatening social influence.",
  threaten: "Use verbal intimidation or threats to influence another person.",
  disguise: "Change appearance or presentation to conceal identity or role.",
  forge: "Create or alter a document, credential, badge, card, or similar artifact deceptively.",
  plant: "Secretly place an object, tracker, evidence, or other item somewhere.",
  observe: "Watch or monitor an area/person without conducting an active search.",
  arrest: "Restrain or take a person into custody under an asserted authority.",
  buy: "Purchase or acquire property through payment.",
  sell: "Sell, list, or transfer property in exchange for payment.",
  hide: "Hide oneself or take a concealed position.",
  work: "Perform a job, shift, gig, task, or employment-like activity.",
  interact:
    "Perform an ordinary physical interaction not covered by a more specific supported action type.",
  exercise:
    "Perform a deliberate ordinary exercise repetition or set such as a push-up, sit-up, squat, plank, or similar body exercise.",
  routine_body_action:
    "Perform a simple ordinary self-directed body action such as sitting, standing, stretching, blinking, breathing, clapping, waving, smiling, nodding, kneeling, or lying down.",
  ask: "Ask the game/system for player-safe factual information rather than speaking to an in-world person.",
} as const;

type DetailedActionType = keyof typeof actionTypeCriteria;

const actionTypeKind: Record<DetailedActionType, WorldActionKind> = {
  detect: "search",
  move: "move",
  search: "search",
  talk: "dialogue",
  attack: "combat",
  steal: "transfer",
  pick_up: "transfer",
  give: "transfer",
  transfer: "transfer",
  put_in: "transfer",
  drop: "transfer",
  sneak: "interact",
  lockpick: "interact",
  hack: "interact",
  heal: "interact",
  consume: "consume",
  craft: "interact",
  drive: "move",
  bribe: "relationship",
  persuade: "relationship",
  threaten: "relationship",
  disguise: "interact",
  forge: "interact",
  plant: "interact",
  observe: "interact",
  arrest: "combat",
  buy: "transfer",
  sell: "transfer",
  hide: "interact",
  work: "interact",
  interact: "interact",
  exercise: "interact",
  routine_body_action: "interact",
  ask: "question",
};

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function lexicalMatch(command: string, candidate: EntityReferenceCandidate) {
  const haystack = ` ${normalized(command)} `;
  const labels = [candidate.displayName, ...candidate.aliases, ...candidate.relationshipLabels]
    .map(normalized)
    .filter((value) => value.length >= 2);
  const matched = labels.filter((label) => haystack.includes(` ${label} `));
  const longest = matched.reduce((maximum, label) => Math.max(maximum, label.length), 0);
  return { matched: matched.length > 0, longest };
}

export function shortlistDecisionCandidates(
  command: string,
  candidates: EntityReferenceCandidate[],
  maximum = MAX_DECISION_CANDIDATES,
) {
  return [...candidates]
    .map((candidate) => ({
      candidate,
      lexical: lexicalMatch(command, candidate),
    }))
    .sort(
      (left, right) =>
        Number(right.lexical.matched) - Number(left.lexical.matched) ||
        right.lexical.longest - left.lexical.longest ||
        Number(right.candidate.present) - Number(left.candidate.present) ||
        Number(right.candidate.accessible) - Number(left.candidate.accessible) ||
        right.candidate.relevanceScore - left.candidate.relevanceScore ||
        left.candidate.entityId.localeCompare(right.candidate.entityId),
    )
    .slice(0, maximum)
    .map(({ candidate }) => candidate);
}

function mentionText(command: string, candidate: EntityReferenceCandidate) {
  const labels = [candidate.displayName, ...candidate.aliases, ...candidate.relationshipLabels]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  const lowerCommand = command.toLowerCase();
  const found = labels.find((label) => lowerCommand.includes(label.toLowerCase()));
  return found || candidate.displayName;
}

function mentionKind(command: string, candidate: EntityReferenceCandidate) {
  const text = mentionText(command, candidate);
  if (text.toLowerCase() === candidate.displayName.toLowerCase()) return "proper_name" as const;
  if (candidate.aliases.some((alias) => alias.toLowerCase() === text.toLowerCase())) {
    return "alias" as const;
  }
  if (
    candidate.relationshipLabels.some(
      (relationship) => relationship.toLowerCase() === text.toLowerCase(),
    )
  ) {
    return "relationship" as const;
  }
  return "description" as const;
}

type ReferenceProbability = {
  candidate: EntityReferenceCandidate;
  probability: number;
  role: CandidateReferenceRole;
};

function referenceInterpretation(
  command: string,
  ranked: ReferenceProbability[],
  clarificationProbability: number,
): EntityReferenceInterpretation {
  const plausible = ranked.filter(
    ({ probability }) => probability >= REFERENCE_AMBIGUOUS_THRESHOLD,
  );
  const dominant = plausible[0];
  const competingSameRole = dominant
    ? plausible.find(
        ({ candidate, role }) =>
          candidate.entityId !== dominant.candidate.entityId &&
          role === dominant.role &&
          role !== "none",
      )
    : undefined;
  const roleAmbiguous = Boolean(
    dominant &&
    competingSameRole &&
    dominant.probability - competingSameRole.probability < REFERENCE_DOMINANCE_GAP,
  );
  const ambiguous = roleAmbiguous || clarificationProbability >= CLARIFICATION_THRESHOLD;

  if (ambiguous && plausible.length >= 2) {
    const candidates =
      roleAmbiguous && dominant
        ? plausible.filter(({ role }) => role === dominant.role).slice(0, 3)
        : plausible.slice(0, 3);
    return EntityReferenceInterpretationSchema.parse({
      mentions: [
        {
          order: 1,
          mentionText: candidates.map(({ candidate }) => candidate.displayName).join(" / "),
          mentionKind: "description",
          status: "ambiguous",
          candidateEntityIds: candidates.map(({ candidate }) => candidate.entityId),
          confidenceBasisPoints: Math.round((dominant?.probability || 0.5) * 10_000),
          supportingFactIds: candidates
            .flatMap(({ candidate }) => candidate.supportingFactIds)
            .slice(0, 32),
          requiresClarification: true,
          clarificationPrompt: `Did you mean ${candidates
            .map(({ candidate }) => candidate.displayName)
            .join(" or ")}?`,
          rationale: "Jev found multiple materially plausible persistent references.",
        },
      ],
    });
  }

  const selected = ranked.filter(
    ({ candidate, probability }) =>
      probability >= REFERENCE_RESOLVE_THRESHOLD &&
      (candidate.accessible || probability >= REMOTE_REFERENCE_RESOLVE_THRESHOLD),
  );
  return EntityReferenceInterpretationSchema.parse({
    mentions: selected.slice(0, 8).map(({ candidate, probability }, index) => ({
      order: index + 1,
      mentionText: mentionText(command, candidate),
      mentionKind: mentionKind(command, candidate),
      status: "resolved",
      selectedEntityId: candidate.entityId,
      candidateEntityIds: [candidate.entityId],
      confidenceBasisPoints: Math.round(probability * 10_000),
      supportingFactIds: candidate.supportingFactIds,
      requiresClarification: false,
      rationale: "Jev selected one supplied persistent candidate above the fast-path threshold.",
    })),
  });
}

function compactCandidate(candidate: EntityReferenceCandidate) {
  return {
    id: candidate.entityId,
    name: candidate.displayName,
    type: candidate.definitionType,
    aliases: candidate.aliases.slice(0, 6),
    relationships: candidate.relationshipLabels.slice(0, 6),
    present: candidate.present,
    accessible: candidate.accessible,
    lifecycle: candidate.lifecycleStatus,
  };
}

export type FastWorldActionDecision = {
  kind: WorldActionKind;
  actionType: DetailedActionType;
  kindConfidence: number;
  actionTypeConfidence: number;
  clarificationProbability: number;
  multiStepProbability: number;
  interpretation: EntityReferenceInterpretation;
  selectedEntityIds: string[];
  selectedEntityRoles: Record<string, PlanReferenceRole>;
  fastPathEligible: boolean;
  fallbackReasons: string[];
  requestedModel: string;
  actualModel: string;
  providerRequestId?: string;
  latencyMs: number;
};

export async function decideWorldActionFastPath(
  client: Pick<AiDecisionClient, "decide">,
  input: {
    command: string;
    actorId: string;
    enabledHandlers: WorldActionKind[];
    recentPlayerSafeText: string[];
    candidates: EntityReferenceCandidate[];
  },
): Promise<FastWorldActionDecision> {
  const shortlisted = shortlistDecisionCandidates(input.command, input.candidates);
  const enabledActionTypes = Object.fromEntries(
    Object.entries(actionTypeCriteria).filter(([actionType]) =>
      input.enabledHandlers.includes(actionTypeKind[actionType as DetailedActionType]),
    ),
  );

  const questions: Record<string, DecisionChoiceQuestion | DecisionNoulQuestion> = {
    action_type: {
      type: "choice",
      instructions:
        "Choose the most specific supported Nocturne action type that describes the player's terminal action. Use the action itself, not an incidental prerequisite. Prefer a specific action type over generic interact when one applies.",
      criteria: enabledActionTypes,
    },
    requires_clarification: {
      type: "noul",
      instructions:
        "Does the player's intended action or material entity reference remain ambiguous enough that choosing silently could act on the wrong persistent entity?",
      criteria: {
        true: "Material ambiguity remains and the player should clarify.",
        false: "The intended action and any important references are sufficiently clear.",
      },
    },
    requires_multi_step: {
      type: "noul",
      instructions:
        "Did the player explicitly request multiple ordered in-world actions or a compound sequence? Do not count implicit prerequisites, tool use, entering a vehicle, physical feasibility problems, or actions the engine might require to make an impossible request possible. A single requested action remains one step even if the engine later rejects it.",
      criteria: {
        true: "Multiple ordered action steps or dependencies are required.",
        false: "One action step can represent the command.",
      },
    },
  };

  shortlisted.forEach((candidate, index) => {
    questions[`role_${index}`] = {
      type: "choice",
      instructions: `For candidate ${JSON.stringify(candidate.displayName)} (${candidate.entityId}), choose the semantic role it plays in the player's command. Choose none when it is merely nearby/relevant and not actually referenced. For transfer-like actions (pick up, drop, give, buy, sell, steal, transfer, put into), the item being moved is resource; a recipient/person acted upon is target; a destination receptacle is container.`,
      criteria: referenceRoleCriteria,
    };
  });

  const result = await client.decide({
    task: "route_world_action",
    state: {
      command: input.command,
      actorId: input.actorId,
      recentPlayerSafeText: input.recentPlayerSafeText.slice(-8),
      candidates: shortlisted.map(compactCandidate),
    },
    questions,
  });

  const detailed = requireDecisionChoice(result.answers.action_type, "action_type");
  if (!(detailed.choice in actionTypeKind)) {
    throw new Error(`Jev returned unsupported action type ${JSON.stringify(detailed.choice)}.`);
  }
  const actionType = detailed.choice as DetailedActionType;
  const kind = WorldActionKindSchema.parse(actionTypeKind[actionType]);
  const clarification = requireDecisionNoul(
    result.answers.requires_clarification,
    "requires_clarification",
  );
  const multiStep = requireDecisionNoul(result.answers.requires_multi_step, "requires_multi_step");

  const ranked = shortlisted
    .map((candidate, index) => {
      const answer = requireDecisionChoice(result.answers[`role_${index}`], `role_${index}`);
      const role = answer.choice as CandidateReferenceRole;
      if (!(role in referenceRoleCriteria)) {
        throw new Error(
          `Jev returned unsupported reference role ${JSON.stringify(answer.choice)}.`,
        );
      }
      const probability =
        role === "none"
          ? Math.max(0, 1 - (answer.probabilities?.none ?? answer.confidence ?? 1))
          : (answer.probabilities?.[role] ?? answer.confidence ?? 0);
      return {
        candidate,
        probability,
        role,
      };
    })
    .sort(
      (left, right) =>
        right.probability - left.probability ||
        right.candidate.relevanceScore - left.candidate.relevanceScore,
    );

  const interpretation = referenceInterpretation(input.command, ranked, clarification.noul);
  const selectedEntityIds = interpretation.mentions.flatMap((mention) =>
    mention.status === "resolved" && mention.selectedEntityId ? [mention.selectedEntityId] : [],
  );
  const selectedSet = new Set(selectedEntityIds);
  const selectedEntityRoles = Object.fromEntries(
    ranked
      .filter(({ candidate, role }) => selectedSet.has(candidate.entityId) && role !== "none")
      .map(({ candidate, role }) => [candidate.entityId, role as PlanReferenceRole]),
  );

  const fallbackReasons: string[] = [];
  const actionTypeConfidence =
    detailed.confidence ?? Math.max(...Object.values(detailed.probabilities || {}), 0);
  const kindConfidence = actionTypeConfidence;
  if (actionTypeConfidence < MIN_KIND_CONFIDENCE)
    fallbackReasons.push("low_action_type_confidence");
  if (clarification.noul >= CLARIFICATION_THRESHOLD) fallbackReasons.push("clarification");
  if (multiStep.noul >= MULTI_STEP_THRESHOLD) fallbackReasons.push("multi_step");
  if (interpretation.mentions.some(({ status }) => status === "ambiguous")) {
    fallbackReasons.push("ambiguous_reference");
  }

  return {
    kind,
    actionType,
    kindConfidence,
    actionTypeConfidence,
    clarificationProbability: clarification.noul,
    multiStepProbability: multiStep.noul,
    interpretation,
    selectedEntityIds,
    selectedEntityRoles,
    fastPathEligible: fallbackReasons.length === 0,
    fallbackReasons,
    requestedModel: result.requestedModel,
    actualModel: result.actualModel,
    providerRequestId: result.providerRequestId,
    latencyMs: result.latencyMs,
  };
}

function requestedSearchConcept(command: string) {
  const trimmed = command.trim().replace(/[.!?]+$/, "");
  const forMatch = /\bfor\s+(.+)$/i.exec(trimmed);
  const findMatch = /\bfind\s+(.+)$/i.exec(trimmed);
  const raw = (forMatch?.[1] || findMatch?.[1] || "").replace(/^(?:a|an|the|some)\s+/i, "").trim();
  return raw.length >= 2 && raw.length <= 180 ? raw : null;
}

function locationEntity(context: RelevanceCompiledContext, entityIds: string[]) {
  const byId = new Map(context.entities.map((entity) => [entity.entityId, entity]));
  return entityIds
    .map((entityId) => byId.get(entityId))
    .find((entity) =>
      /(?:location|residence|place|building|room|area)/i.test(entity?.definitionType || ""),
    );
}

export function buildFastSingleStepPlan(input: {
  command: string;
  actorId: string;
  kind: WorldActionKind;
  actionType: string;
  selectedEntityIds: string[];
  selectedEntityRoles?: Record<string, PlanReferenceRole>;
  context: RelevanceCompiledContext;
}): PersistentActionPlanProposal {
  const entityMap = new Map(input.context.entities.map((entity) => [entity.entityId, entity]));
  const referencedEntities: PersistentActionPlanProposal["steps"][number]["referencedEntities"] = [
    {
      entityId: input.actorId,
      role: "actor",
      expectedVersion: entityMap.get(input.actorId)?.version,
    },
    ...input.selectedEntityIds
      .filter((entityId) => entityId !== input.actorId)
      .map((entityId) => ({
        entityId,
        role: input.selectedEntityRoles?.[entityId] || ("target" as const),
        expectedVersion: entityMap.get(entityId)?.version,
      })),
  ];

  const idsForRole = (role: PlanReferenceRole) =>
    input.selectedEntityIds.filter((entityId) => input.selectedEntityRoles?.[entityId] === role);
  const targetIds = idsForRole("target");
  const methodIds = idsForRole("method");
  const resourceIds = idsForRole("resource");
  const vehicleIds = idsForRole("vehicle");
  const containerIds = idsForRole("container");
  const companionIds = idsForRole("companion");
  const locationIds = idsForRole("location");

  const effectiveTargetIds =
    input.actionType === "put_in" && containerIds.length ? containerIds : targetIds;

  let intentPayload: Record<string, unknown> = {
    rawText: input.command,
    actionType: input.actionType,
    ...(effectiveTargetIds.length ? { targetIds: effectiveTargetIds } : {}),
    ...(methodIds.length ? { methodIds } : {}),
    ...(resourceIds.length ? { resourceIds } : {}),
    ...(vehicleIds.length ? { vehicleIds } : {}),
    ...(containerIds.length ? { containerIds } : {}),
    ...(companionIds.length ? { companionIds } : {}),
    ...(locationIds.length === 1 ? { locationId: locationIds[0] } : {}),
  };

  if (input.kind === "move") {
    if (input.actionType === "drive") {
      throw new Error(
        "Vehicle travel requires authoritative actor-and-vehicle cohort movement, which is not enabled in this runtime yet.",
      );
    }
    const destination = locationEntity(input.context, input.selectedEntityIds);
    if (!destination) {
      throw new Error("Jev fast-path movement requires one resolved persistent destination.");
    }
    intentPayload = {
      rawText: input.command,
      actionType: input.actionType,
      locationId: destination.entityId,
      destinationId: destination.entityId,
    };
  } else if (input.kind === "search") {
    const actor = entityMap.get(input.actorId);
    const selectedArea = locationEntity(input.context, input.selectedEntityIds);
    const areaId = selectedArea?.entityId || actor?.locationId;
    const requestedConcept = requestedSearchConcept(input.command);
    if (!areaId || !requestedConcept) {
      throw new Error(
        "Jev fast-path search requires a current/selected area and an explicit requested concept.",
      );
    }
    intentPayload = {
      rawText: input.command,
      actionType: input.actionType,
      areaId,
      requestedConcept,
    };
  }

  return {
    originalCommand: input.command,
    exclusivePhysical: !["dialogue", "question"].includes(input.kind),
    steps: [
      {
        order: 1,
        kind: input.kind,
        description: input.command,
        intentPayload,
        referencedEntities,
      },
    ],
    dependencies: [],
  };
}
