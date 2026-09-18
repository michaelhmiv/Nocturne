import {
  ConsumableAnalysisSchema,
  ConsumptionAnalysisRequestSchema,
  type ConsumableAnalysis,
  type ConsumptionAnalysisRequest,
} from "@nocturne/contracts";
import {
  requireDecisionChoice,
  requireDecisionNoul,
  type AiDecisionClient,
  type DecisionChoiceQuestion,
  type DecisionNoulQuestion,
} from "./decision-client.js";
import { validateConsumableAnalysisAgainstContext } from "./consumable-analyzer.js";

export const CONSUMABLE_DECISION_POLICY_VERSION = "consumable-decision-v1";

const MIN_SOURCE_CONFIDENCE = 0.7;
const MIN_BOOLEAN_CONFIDENCE = 0.7;

const numberWords: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function requestedUnits(rawText: string) {
  const match = rawText
    .toLowerCase()
    .match(/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\b/);
  if (!match?.[1]) return 1;
  const parsed = Number(match[1]);
  return Math.max(1, Math.min(100, Number.isFinite(parsed) ? parsed : numberWords[match[1]] || 1));
}

const substanceCriteria = {
  ordinary_food:
    "Ordinary food whose main gameplay effect is satiety/nutrition rather than medicine or intoxication.",
  nonalcoholic_drink: "Ordinary nonalcoholic drink whose main gameplay effect is hydration.",
  alcohol: "Alcoholic beverage or ethanol-containing drink.",
  medicine: "Medicine or therapeutic substance intended to treat a condition.",
  drug: "Recreational, psychoactive, stimulant, sedative, or otherwise pharmacologically active drug.",
  toxic_substance: "Poisonous, caustic, contaminated, or otherwise toxic substance.",
  nonconsumable: "Not plausibly consumable in the requested manner.",
  unusual_or_unknown:
    "Fictional, unusual, ambiguous, or insufficiently understood substance that needs richer semantic analysis.",
} as const;

const freshnessCriteria = {
  ordinary: "No supplied fact indicates unusual freshness or spoilage.",
  fresh: "Supplied evidence specifically supports fresh/recent preparation.",
  stale: "Supplied evidence supports staleness or degraded quality but not clear danger.",
  spoiled: "Supplied evidence supports spoilage, contamination, or likely danger.",
  unknown: "Freshness cannot be characterized from supplied evidence.",
} as const;

export type ConsumableFastDecision = {
  analysis: ConsumableAnalysis | null;
  fastPathEligible: boolean;
  fallbackReason?: string;
  requestedModel: string;
  actualModel: string;
  providerRequestId?: string;
  latencyMs: number;
};

export async function decideConsumableFastPath(
  client: Pick<AiDecisionClient, "decide">,
  input: ConsumptionAnalysisRequest,
): Promise<ConsumableFastDecision> {
  const parsed = ConsumptionAnalysisRequestSchema.parse(input);
  const sourceCriteria = Object.fromEntries([
    ...parsed.candidates.map((candidate, index) => [
      `source_${index}`,
      {
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
        name: candidate.name,
        description: candidate.description,
        access: candidate.access,
        quantity: candidate.quantity ?? 1,
        state: candidate.state,
        constraints: candidate.constraints,
      },
    ]),
    ["none", "No supplied authoritative candidate matches the requested substance."],
  ]);

  const questions: Record<string, DecisionChoiceQuestion | DecisionNoulQuestion> = {
    source: {
      type: "choice",
      instructions:
        "Choose the one supplied authoritative source the player is attempting to consume. Do not invent a source. Choose none when no supplied source plausibly matches.",
      criteria: sourceCriteria,
    },
    consumable: {
      type: "noul",
      instructions:
        "Is the selected/requested substance plausibly consumable in the manner requested? This asks semantic plausibility only; authoritative availability is checked by code.",
      criteria: {
        true: "The substance can plausibly be consumed as requested.",
        false: "The substance is not plausibly consumable as requested.",
      },
    },
    substance_kind: {
      type: "choice",
      instructions:
        "Classify the requested substance into the safest bounded gameplay category. Choose unusual_or_unknown rather than guessing.",
      criteria: substanceCriteria,
    },
    freshness: {
      type: "choice",
      instructions:
        "Classify freshness only from supplied candidate evidence. Choose ordinary or unknown rather than inventing spoilage.",
      criteria: freshnessCriteria,
    },
  };

  const result = await client.decide({
    task: "analyze_consumable",
    state: {
      request: parsed.rawText,
      location: {
        name: parsed.locationName,
        description: parsed.locationDescription,
      },
      candidates: parsed.candidates,
    },
    questions,
  });

  const source = requireDecisionChoice(result.answers.source, "source");
  const consumable = requireDecisionNoul(result.answers.consumable, "consumable");
  const kind = requireDecisionChoice(result.answers.substance_kind, "substance_kind");
  const freshness = requireDecisionChoice(result.answers.freshness, "freshness");

  const sourceConfidence =
    source.confidence ?? Math.max(...Object.values(source.probabilities || {}), 0);
  const booleanConfidence = Math.max(consumable.noul, 1 - consumable.noul);
  const units = requestedUnits(parsed.rawText);

  if (source.choice === "none") {
    const analysis = validateConsumableAnalysisAgainstContext(
      ConsumableAnalysisSchema.parse({
        selection: {
          sourceType: "none",
          displayName: "No accessible matching substance",
          rationale: "Jev found no matching supplied authoritative source.",
          confidence: sourceConfidence,
        },
        classification: {
          consumable: false,
          substanceKind: kind.choice,
          portionDescription: "none",
          freshnessAssessment: freshness.choice,
          confidence: booleanConfidence,
        },
        requestedUnits: units,
        consumeUnits: 0,
        resourceDeltas: [],
        conditions: [],
        risks: [],
        narrationFacts: ["No supplied source matched the requested substance."],
        assumptions: [],
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

  if (sourceConfidence < MIN_SOURCE_CONFIDENCE || booleanConfidence < MIN_BOOLEAN_CONFIDENCE) {
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

  const sourceIndex = Number(source.choice.replace("source_", ""));
  const candidate = parsed.candidates[sourceIndex];
  if (!candidate) {
    return {
      analysis: null,
      fastPathEligible: false,
      fallbackReason: "invalid_source_choice",
      requestedModel: result.requestedModel,
      actualModel: result.actualModel,
      providerRequestId: result.providerRequestId,
      latencyMs: result.latencyMs,
    };
  }

  const definitelyNotConsumable = consumable.noul <= 1 - MIN_BOOLEAN_CONFIDENCE;
  if (definitelyNotConsumable || kind.choice === "nonconsumable") {
    const analysis = validateConsumableAnalysisAgainstContext(
      ConsumableAnalysisSchema.parse({
        selection: {
          sourceType: candidate.sourceType,
          sourceId: candidate.sourceId,
          displayName: candidate.name,
          rationale: "Jev selected this supplied source and classified it as non-consumable.",
          confidence: sourceConfidence,
        },
        classification: {
          consumable: false,
          substanceKind: kind.choice,
          portionDescription: "none",
          freshnessAssessment: freshness.choice,
          confidence: booleanConfidence,
        },
        requestedUnits: units,
        consumeUnits: 0,
        resourceDeltas: [],
        conditions: [],
        risks: [],
        narrationFacts: [`${candidate.name} is not consumable as requested.`],
        assumptions: [],
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

  if (
    !["ordinary_food", "nonalcoholic_drink"].includes(kind.choice) ||
    consumable.noul < MIN_BOOLEAN_CONFIDENCE
  ) {
    return {
      analysis: null,
      fastPathEligible: false,
      fallbackReason: `rich_semantics_required:${kind.choice}`,
      requestedModel: result.requestedModel,
      actualModel: result.actualModel,
      providerRequestId: result.providerRequestId,
      latencyMs: result.latencyMs,
    };
  }

  const availableUnits = Math.max(1, Math.floor(candidate.quantity ?? 1));
  const modeledUnits = Math.max(1, Math.min(units, availableUnits, 5));
  const resource =
    kind.choice === "ordinary_food"
      ? {
          resource: "satiety",
          delta: Math.min(25, 5 * modeledUnits),
          rationale: "Ordinary food provides a modest satiety benefit.",
        }
      : {
          resource: "hydration",
          delta: Math.min(25, 5 * modeledUnits),
          rationale: "An ordinary nonalcoholic drink provides a modest hydration benefit.",
        };
  const materialization =
    candidate.sourceType === "ambient_pool"
      ? {
          name: candidate.name,
          conceptSummary: candidate.description,
          descriptiveTraits: ["ordinary", kind.choice],
          unitsCreated: modeledUnits,
        }
      : undefined;

  const analysis = validateConsumableAnalysisAgainstContext(
    ConsumableAnalysisSchema.parse({
      selection: {
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
        displayName: candidate.name,
        rationale: "Jev selected this supplied source above the fast-path confidence threshold.",
        confidence: sourceConfidence,
      },
      classification: {
        consumable: true,
        substanceKind: kind.choice,
        portionDescription:
          modeledUnits === 1 ? "one ordinary serving" : `${modeledUnits} ordinary servings`,
        freshnessAssessment: freshness.choice,
        confidence: booleanConfidence,
      },
      requestedUnits: units,
      consumeUnits: modeledUnits,
      materialization,
      resourceDeltas: [resource],
      conditions: [],
      risks: [],
      narrationFacts: [
        `${modeledUnits} unit${modeledUnits === 1 ? "" : "s"} of ${candidate.name} can be consumed.`,
      ],
      assumptions: [
        "Jev fast-path effects are intentionally conservative for ordinary food and nonalcoholic drink categories.",
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
