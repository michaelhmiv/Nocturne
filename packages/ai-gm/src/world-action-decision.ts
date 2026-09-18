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

const kindCriteria: Record<WorldActionKind, string> = {
  search:
    "Look for, inspect for, or attempt to discover a person, item, route, entrance, evidence, resource, or information.",
  move: "Travel or move from the current place to another location.",
  consume:
    "Eat, drink, swallow, inhale, inject, taste, or otherwise consume a substance or resource.",
  relationship:
    "Attempt to change an ongoing social relationship, affiliation, following, companionship, trust, or similar persistent social state.",
  combat: "Attack, fight, restrain, physically harm, or violently oppose another entity.",
  transfer:
    "Give, take, buy, sell, pick up, drop, steal, hand over, or otherwise change possession or ownership.",
  interact:
    "Ordinary physical interaction with an object, person, or environment that is not movement, combat, consumption, or transfer.",
  dialogue:
    "Speak, ask conversationally, communicate, call, message, threaten verbally, persuade, or otherwise converse.",
  question:
    "Ask the game/system for player-safe factual information rather than performing an in-world social interaction.",
};

const actionTypeCriteria = {
  detect: "Actively scan or check for hidden threats, surveillance, danger, or signs of presence.",
  move: "Move on foot or otherwise relocate without specifically operating a vehicle.",
  search:
    "Search an area for a requested person, item, evidence, resource, entrance, or other concept.",
  talk: "Speak, ask, converse, call, message, or otherwise communicate normally.",
  attack: "Physically attack, strike, punch, fight, or injure a target.",
  steal: "Take property without permission or otherwise commit theft.",
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
  observe: "search",
  arrest: "combat",
  buy: "transfer",
  sell: "transfer",
  hide: "interact",
  work: "interact",
  interact: "interact",
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
  const second = plausible[1];
  const ambiguous =
    Boolean(
      dominant && second && dominant.probability - second.probability < REFERENCE_DOMINANCE_GAP,
    ) || clarificationProbability >= CLARIFICATION_THRESHOLD;

  if (ambiguous && plausible.length >= 2) {
    const candidates = plausible.slice(0, 3);
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
  const intentCriteria = Object.fromEntries(
    input.enabledHandlers.map((kind) => [kind, kindCriteria[kind]]),
  );

  const questions: Record<string, DecisionChoiceQuestion | DecisionNoulQuestion> = {
    primary_kind: {
      type: "choice",
      instructions:
        "Choose the player's terminal action kind. Choose the action they ultimately want to perform, not an incidental supporting motion.",
      criteria: intentCriteria,
    },
    action_type: {
      type: "choice",
      instructions:
        "Choose the most specific supported Nocturne action type that describes the player's terminal action. Use the action itself, not an incidental prerequisite.",
      criteria: actionTypeCriteria,
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
        "Does fulfilling the command require multiple ordered in-world actions, prerequisites, travel plus another action, or a compound sequence rather than one action step?",
      criteria: {
        true: "Multiple ordered action steps or dependencies are required.",
        false: "One action step can represent the command.",
      },
    },
  };

  shortlisted.forEach((candidate, index) => {
    questions[`ref_${index}`] = {
      type: "noul",
      instructions:
        "Does the player's command materially refer to this specific supplied persistent entity? Do not select it merely because it is nearby or relevant.",
      criteria: {
        true: compactCandidate(candidate),
        false: "The command does not refer to this candidate.",
      },
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

  const primary = requireDecisionChoice(result.answers.primary_kind, "primary_kind");
  const detailed = requireDecisionChoice(result.answers.action_type, "action_type");
  const kind = WorldActionKindSchema.parse(primary.choice);
  const actionType = detailed.choice as DetailedActionType;
  const clarification = requireDecisionNoul(
    result.answers.requires_clarification,
    "requires_clarification",
  );
  const multiStep = requireDecisionNoul(result.answers.requires_multi_step, "requires_multi_step");

  const ranked = shortlisted
    .map((candidate, index) => {
      const answer = requireDecisionNoul(result.answers[`ref_${index}`], `ref_${index}`);
      return {
        candidate,
        probability: answer.noul,
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

  const fallbackReasons: string[] = [];
  const kindConfidence =
    primary.confidence ?? Math.max(...Object.values(primary.probabilities || {}), 0);
  const actionTypeConfidence =
    detailed.confidence ?? Math.max(...Object.values(detailed.probabilities || {}), 0);
  if (!(actionType in actionTypeKind)) fallbackReasons.push("unknown_action_type");
  if (actionTypeKind[actionType] !== kind) fallbackReasons.push("action_type_kind_mismatch");
  if (kindConfidence < MIN_KIND_CONFIDENCE) fallbackReasons.push("low_kind_confidence");
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
        role: "target" as const,
        expectedVersion: entityMap.get(entityId)?.version,
      })),
  ];

  let intentPayload: Record<string, unknown> = {
    rawText: input.command,
    actionType: input.actionType,
  };

  if (input.kind === "move") {
    const destination = locationEntity(input.context, input.selectedEntityIds);
    if (!destination) {
      throw new Error("Jev fast-path movement requires one resolved persistent destination.");
    }
    intentPayload = {
      rawText: input.command,
      actionType: input.actionType,
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
