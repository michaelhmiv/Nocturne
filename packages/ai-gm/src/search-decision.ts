import {
  SearchDiscoveryAnalysisRequestSchema,
  SearchDiscoveryAnalysisSchema,
  type SearchDiscoveryAnalysis,
  type SearchDiscoveryAnalysisRequest,
  type SearchTargetFamily,
} from "@nocturne/contracts";
import {
  requireDecisionChoice,
  requireDecisionScore,
  type AiDecisionClient,
  type DecisionChoiceQuestion,
  type DecisionScoreQuestion,
} from "./decision-client.js";
import { validateSearchAnalysis } from "./search-analyzer.js";

export const SEARCH_DECISION_POLICY_VERSION = "search-discovery-decision-v1";

const MIN_DECISION_CONFIDENCE = 0.65;

const targetFamilyCriteria: Record<SearchTargetFamily, string> = {
  animal: "An animal or creature.",
  person: "A person or character.",
  item: "A movable item, tool, object, or possession.",
  entrance: "An entrance, exit, opening, door, hatch, or access point.",
  evidence: "Evidence, traces, clues, or forensic signs.",
  resource: "A useful natural or stocked resource.",
  route: "A route, path, passage, or navigable way.",
  hazard: "A danger, trap, threat, or environmental hazard.",
  hidden_space: "A concealed room, compartment, cache, or hidden physical space.",
  information: "Information, records, facts, or knowledge rather than a physical object.",
  other: "A search concept that does not fit the supplied bounded families.",
};

const capabilityCriteria = [
  "Very poor search position or capability.",
  "Poor search position or capability.",
  "Clearly below-average search position or capability.",
  "Somewhat weak search position or capability.",
  "Slightly weak search position or capability.",
  "Neutral or ordinary search position or capability.",
  "Slightly favorable search position or capability.",
  "Moderately favorable search position or capability.",
  "Strong search position or capability.",
  "Very strong search position or capability.",
  "Exceptional search position or capability.",
];

const difficultyCriteria = [
  "Trivial to locate or verify.",
  "Very easy to locate or verify.",
  "Easy to locate or verify.",
  "Somewhat easy to locate or verify.",
  "Slightly easier than ordinary.",
  "Ordinary search difficulty.",
  "Slightly difficult to locate or verify.",
  "Moderately difficult to locate or verify.",
  "Hard to locate or verify.",
  "Very hard to locate or verify.",
  "Exceptional concealment or difficulty.",
];

function descriptions(input: SearchDiscoveryAnalysisRequest) {
  const concept = input.requestedConcept;
  return {
    successDescription: `You successfully locate evidence or a match for ${concept}.`,
    consequenceDescription: `You locate evidence or a match for ${concept}, but the search carries a consequence.`,
    partialDescription: `You uncover partial evidence related to ${concept}, but not a complete discovery.`,
    progressDescription: `You make progress toward locating ${concept}, but do not complete the search.`,
    failureDescription: `You do not locate ${concept}.`,
    reversalDescription: `The search goes badly and does not locate ${concept}.`,
  };
}

function confidence(answer: { confidence?: number; probabilities?: Record<string, number> }) {
  return answer.confidence ?? Math.max(0, ...Object.values(answer.probabilities || {}));
}

export type SearchDecisionResult = {
  analysis: SearchDiscoveryAnalysis | null;
  fastPathEligible: boolean;
  fallbackReason?: string;
  requestedModel: string;
  actualModel: string;
  providerRequestId?: string;
  latencyMs: number;
};

export async function decideSearchDiscovery(
  client: Pick<AiDecisionClient, "decide">,
  input: SearchDiscoveryAnalysisRequest,
): Promise<SearchDecisionResult> {
  const parsed = SearchDiscoveryAnalysisRequestSchema.parse(input);

  const sourceCriteria: Record<string, string | Record<string, unknown>> = {
    none: "No supplied existing entity matches and no authorized materialization source plausibly supports the request.",
  };
  parsed.existingCandidates.forEach((candidate, index) => {
    sourceCriteria[`existing_${index}`] = {
      kind: "existing_entity",
      entityId: candidate.entityId,
      name: candidate.name,
      conceptSummary: candidate.conceptSummary,
      hidden: candidate.hidden,
      concealment: candidate.concealment,
    };
  });
  parsed.materializationSourceIds.forEach((sourceId, index) => {
    sourceCriteria[`materialize_${index}`] = {
      kind: "authorized_materialization_source",
      sourceId,
    };
  });

  const questions: Record<string, DecisionChoiceQuestion | DecisionScoreQuestion> = {
    target_family: {
      type: "choice",
      instructions:
        "Classify the player's requested search target into exactly one supplied target family.",
      criteria: targetFamilyCriteria,
    },
    source: {
      type: "choice",
      instructions:
        "Choose an existing supplied entity when it actually matches. Otherwise choose one authorized materialization source only when that source can plausibly support the requested concept. Choose none rather than inventing existence.",
      criteria: sourceCriteria,
    },
    actor_capability: {
      type: "score",
      instructions:
        "Score the actor's search capability and position from supplied actor facts only. Do not invent skills, tools, lighting, access, or conditions.",
      criteria: capabilityCriteria,
    },
    target_difficulty: {
      type: "score",
      instructions:
        "Score how difficult the requested concept is to locate in the searched area from supplied facts, existing candidate concealment, and authorized sources only.",
      criteria: difficultyCriteria,
    },
  };

  const result = await client.decide({
    task: "analyze_search_discovery",
    state: {
      rawText: parsed.rawText,
      actorId: parsed.actorId,
      areaId: parsed.areaId,
      areaName: parsed.areaName,
      areaDescription: parsed.areaDescription,
      requestedConcept: parsed.requestedConcept,
      actorFacts: parsed.actorFacts,
      areaFacts: parsed.areaFacts,
      existingCandidates: parsed.existingCandidates,
      materializationSourceIds: parsed.materializationSourceIds,
    },
    questions,
  });

  const family = requireDecisionChoice(result.answers.target_family, "target_family");
  const source = requireDecisionChoice(result.answers.source, "source");
  const actor = requireDecisionScore(result.answers.actor_capability, "actor_capability");
  const target = requireDecisionScore(result.answers.target_difficulty, "target_difficulty");

  const lowestConfidence = Math.min(
    confidence(family),
    confidence(source),
    actor.confidence ?? 1,
    target.confidence ?? 1,
  );
  if (lowestConfidence < MIN_DECISION_CONFIDENCE) {
    return {
      analysis: null,
      fastPathEligible: false,
      fallbackReason: "low_decision_confidence",
      requestedModel: result.requestedModel,
      actualModel: result.actualModel,
      providerRequestId: result.providerRequestId,
      latencyMs: result.latencyMs,
    };
  }

  let selectedExistingEntityId: string | undefined;
  let selectedMaterializationSourceId: string | undefined;
  if (source.choice.startsWith("existing_")) {
    const index = Number(source.choice.slice("existing_".length));
    selectedExistingEntityId = parsed.existingCandidates[index]?.entityId;
    if (!selectedExistingEntityId) {
      return {
        analysis: null,
        fastPathEligible: false,
        fallbackReason: "invalid_existing_source_choice",
        requestedModel: result.requestedModel,
        actualModel: result.actualModel,
        providerRequestId: result.providerRequestId,
        latencyMs: result.latencyMs,
      };
    }
  } else if (source.choice.startsWith("materialize_")) {
    const index = Number(source.choice.slice("materialize_".length));
    selectedMaterializationSourceId = parsed.materializationSourceIds[index];
    if (!selectedMaterializationSourceId) {
      return {
        analysis: null,
        fastPathEligible: false,
        fallbackReason: "invalid_materialization_source_choice",
        requestedModel: result.requestedModel,
        actualModel: result.actualModel,
        providerRequestId: result.providerRequestId,
        latencyMs: result.latencyMs,
      };
    }
  }

  const analysis = validateSearchAnalysis(
    SearchDiscoveryAnalysisSchema.parse({
      targetFamily: family.choice,
      requestedConcept: parsed.requestedConcept,
      ...(selectedExistingEntityId ? { selectedExistingEntityId } : {}),
      mayMaterialize: Boolean(selectedMaterializationSourceId),
      ...(selectedMaterializationSourceId ? { selectedMaterializationSourceId } : {}),
      actorScore: Math.round(actor.score),
      targetScore: Math.round(target.score),
      modifiers: [],
      ...descriptions(parsed),
      assumptions: [
        "Jev supplied bounded search selection and relative contest scores; the deterministic rules engine resolves the outcome.",
      ],
    }),
    parsed,
  );

  return {
    analysis,
    fastPathEligible: true,
    requestedModel: result.requestedModel,
    actualModel: result.actualModel,
    providerRequestId: result.providerRequestId,
    latencyMs: result.latencyMs,
  };
}
