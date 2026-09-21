import {
  ConsumableAnalysisSchema,
  ConsumptionAnalysisRequestSchema,
  type ConsumableAnalysis,
  type ConsumptionAnalysisRequest,
} from "@nocturne/contracts";
import {
  requireDecisionChoice,
  requireDecisionNoul,
  requireDecisionScore,
  type AiDecisionClient,
  type DecisionChoiceQuestion,
  type DecisionNoulQuestion,
  type DecisionScoreQuestion,
} from "./decision-client.js";
import { validateConsumableAnalysisAgainstContext } from "./consumable-analyzer.js";

export const CONSUMABLE_DECISION_POLICY_VERSION = "consumable-decision-v2";

const MIN_SOURCE_CONFIDENCE = 0.7;
const MIN_BOOLEAN_CONFIDENCE = 0.7;
const MIN_EFFECT_CONFIDENCE = 0.6;

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
    "Fictional, unusual, ambiguous, or insufficiently understood substance. Use this only when the supplied evidence does not fit a safer known category.",
} as const;

const freshnessCriteria = {
  ordinary: "No supplied fact indicates unusual freshness or spoilage.",
  fresh: "Supplied evidence specifically supports fresh/recent preparation.",
  stale: "Supplied evidence supports staleness or degraded quality but not clear danger.",
  spoiled: "Supplied evidence supports spoilage, contamination, or likely danger.",
  unknown: "Freshness cannot be characterized from supplied evidence.",
} as const;

const effectProfileCriteria = {
  neutral: "No meaningful physiological gameplay effect beyond ordinary consumption.",
  nourishment: "Primarily supports hunger/satiety/nutrition.",
  hydration: "Primarily supports hydration.",
  stimulant: "Primarily increases alertness/arousal or stimulant-like activation.",
  sedative: "Primarily produces sedation/drowsiness or depressant effects.",
  analgesic: "Primarily reduces pain perception without directly repairing injury.",
  recovery_support:
    "Therapeutic/supportive effect that may aid recovery but does not instantly repair injury.",
  intoxicating: "Primarily causes ordinary intoxication/impairment.",
  hallucinogenic: "Primarily causes altered perception/hallucinogenic effects.",
  toxic_irritant: "Primarily causes localized irritation, nausea, or short-lived toxicity.",
  toxic_systemic: "Primarily causes systemic poisoning or physically harmful toxicity.",
  unknown: "The supplied evidence does not support a bounded effect profile.",
} as const;

const potencyCriteria = [
  "Negligible or effectively no physiological potency.",
  "Mild potency.",
  "Moderate potency.",
  "Strong potency.",
  "Severe/high potency.",
];

const riskCriteria = [
  "No meaningful adverse-effect risk supported by the supplied evidence.",
  "Low adverse-effect risk.",
  "Moderate adverse-effect risk.",
  "High adverse-effect risk.",
  "Severe adverse-effect risk.",
];

type EffectProfile = keyof typeof effectProfileCriteria;

function confidence(answer: { confidence?: number; probabilities?: Record<string, number> }) {
  return answer.confidence ?? Math.max(0, ...Object.values(answer.probabilities || {}));
}

function boundedScore(value: number) {
  return Math.max(0, Math.min(4, Math.round(value)));
}

function durationFor(potency: number, units: number, baseSeconds = 900) {
  return Math.min(43_200, Math.max(300, baseSeconds * Math.max(1, potency) * Math.max(1, units)));
}

function deterministicEffects(input: {
  substanceKind: string;
  effectProfile: EffectProfile;
  potency: number;
  risk: number;
  units: number;
  freshness: string;
}) {
  const { substanceKind, effectProfile, potency, risk, units, freshness } = input;
  const resourceDeltas: ConsumableAnalysis["resourceDeltas"] = [];
  const conditions: ConsumableAnalysis["conditions"] = [];
  const risks: ConsumableAnalysis["risks"] = [];
  const strength = Math.max(1, potency);
  const amount = Math.max(1, units);

  if (substanceKind === "ordinary_food" || effectProfile === "nourishment") {
    resourceDeltas.push({
      resource: "satiety",
      delta: Math.min(25, 5 * amount),
      rationale: "Ordinary nourishment provides a bounded satiety benefit.",
    });
  } else if (substanceKind === "nonalcoholic_drink" || effectProfile === "hydration") {
    resourceDeltas.push({
      resource: "hydration",
      delta: Math.min(25, 5 * amount),
      rationale: "An ordinary nonalcoholic drink provides a bounded hydration benefit.",
    });
  }

  const addCondition = (
    name: string,
    key: string,
    intensity: number,
    baseSeconds: number,
    rationale: string,
  ) => {
    conditions.push({
      name,
      key,
      intensity: Math.max(-10, Math.min(10, intensity)),
      durationSeconds: durationFor(strength, amount, baseSeconds),
      rationale,
    });
  };

  switch (effectProfile) {
    case "stimulant":
      addCondition(
        "Stimulant effect",
        "stimulant_effect",
        strength,
        900,
        "Jev classified the selected substance as having a stimulant-like dominant effect.",
      );
      break;
    case "sedative":
      addCondition(
        "Sedative effect",
        "sedative_effect",
        -strength,
        1_200,
        "Jev classified the selected substance as having a sedative dominant effect.",
      );
      break;
    case "analgesic":
      addCondition(
        "Analgesic effect",
        "analgesic_effect",
        strength,
        1_800,
        "The substance may reduce pain perception without directly repairing injury.",
      );
      break;
    case "recovery_support":
      addCondition(
        "Recovery support",
        "recovery_support",
        strength,
        1_800,
        "The substance was classified as supportive therapy rather than instant healing.",
      );
      break;
    case "intoxicating":
      addCondition(
        "Intoxicated",
        "intoxicated",
        -strength,
        1_800,
        "The substance was classified as primarily intoxicating.",
      );
      break;
    case "hallucinogenic":
      addCondition(
        "Altered perception",
        "altered_perception",
        -strength,
        1_800,
        "The substance was classified as producing altered perception.",
      );
      break;
    case "toxic_irritant":
      addCondition(
        "Irritated",
        "toxic_irritation",
        -strength,
        900,
        "The substance was classified as an irritant/toxic exposure.",
      );
      break;
    case "toxic_systemic":
      addCondition(
        "Poisoned",
        "poisoned",
        -Math.min(10, strength + amount),
        1_800,
        "The substance was classified as systemically toxic.",
      );
      resourceDeltas.push({
        resource: "condition",
        delta: -Math.min(25, strength * 3 * amount),
        rationale: "Systemic toxicity causes bounded deterministic physical harm.",
      });
      break;
  }

  const spoilageRisk = freshness === "spoiled" ? Math.max(2, risk) : 0;
  const effectiveRisk = Math.max(risk, spoilageRisk);
  if (effectiveRisk > 0 && !["ordinary_food", "nonalcoholic_drink"].includes(substanceKind)) {
    risks.push({
      description: "Adverse reaction",
      chanceBasisPoints: Math.min(
        8_000,
        500 + effectiveRisk * 1_250 + Math.max(0, amount - 1) * 500,
      ),
      resourceDeltas:
        effectProfile === "toxic_systemic"
          ? [
              {
                resource: "condition",
                delta: -Math.min(20, effectiveRisk * 3),
                rationale: "A resolved adverse toxic reaction worsens physical condition.",
              },
            ]
          : [],
      conditions: [
        {
          name: "Adverse reaction",
          key: "adverse_reaction",
          intensity: -Math.min(10, effectiveRisk + 1),
          durationSeconds: durationFor(effectiveRisk + 1, amount, 900),
          rationale: "The deterministic risk roll resolved an adverse effect.",
        },
      ],
    });
  }

  if (spoilageRisk > 0 && ["ordinary_food", "nonalcoholic_drink"].includes(substanceKind)) {
    risks.push({
      description: "Foodborne illness",
      chanceBasisPoints: Math.min(7_500, 1_500 + spoilageRisk * 1_250),
      resourceDeltas: [
        {
          resource: "condition",
          delta: -Math.min(15, spoilageRisk * 3),
          rationale: "A resolved foodborne illness risk reduces physical condition.",
        },
      ],
      conditions: [
        {
          name: "Foodborne illness",
          key: "foodborne_illness",
          intensity: -Math.min(8, spoilageRisk + 1),
          durationSeconds: durationFor(spoilageRisk + 1, amount, 1_800),
          rationale: "The deterministic spoilage risk roll resolved illness.",
        },
      ],
    });
  }

  return { resourceDeltas, conditions, risks };
}

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

  const questions: Record<
    string,
    DecisionChoiceQuestion | DecisionNoulQuestion | DecisionScoreQuestion
  > = {
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
    effect_profile: {
      type: "choice",
      instructions:
        "Classify the dominant physiological gameplay effect supported by the supplied candidate evidence. This does not decide whether the effect succeeds or whether a risk occurs. Choose unknown rather than inventing an effect.",
      criteria: effectProfileCriteria,
    },
    potency: {
      type: "score",
      instructions:
        "Score the supported physiological potency of the selected substance. Use supplied name/description/state/constraints only; do not infer an extreme dose without evidence.",
      criteria: potencyCriteria,
    },
    adverse_risk: {
      type: "score",
      instructions:
        "Score the supported adverse-effect risk of consuming the selected substance in the requested amount. This is a semantic risk band only; code resolves any random outcome.",
      criteria: riskCriteria,
    },
  };

  const result = await client.decide({
    task: "analyze_consumable",
    state: {
      request: parsed.rawText,
      actorState: parsed.actorState,
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
  const effectProfile = requireDecisionChoice(result.answers.effect_profile, "effect_profile");
  const potencyAnswer = requireDecisionScore(result.answers.potency, "potency");
  const riskAnswer = requireDecisionScore(result.answers.adverse_risk, "adverse_risk");

  const sourceConfidence = confidence(source);
  const booleanConfidence = Math.max(consumable.noul, 1 - consumable.noul);
  const effectConfidence = confidence(effectProfile);
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

  const profile = effectProfile.choice as EffectProfile;
  if (!(profile in effectProfileCriteria)) {
    return {
      analysis: null,
      fastPathEligible: false,
      fallbackReason: "invalid_effect_profile",
      requestedModel: result.requestedModel,
      actualModel: result.actualModel,
      providerRequestId: result.providerRequestId,
      latencyMs: result.latencyMs,
    };
  }
  if (
    kind.choice === "unusual_or_unknown" &&
    (profile === "unknown" || effectConfidence < MIN_EFFECT_CONFIDENCE)
  ) {
    return {
      analysis: null,
      fastPathEligible: false,
      fallbackReason: "unknown_substance_semantics",
      requestedModel: result.requestedModel,
      actualModel: result.actualModel,
      providerRequestId: result.providerRequestId,
      latencyMs: result.latencyMs,
    };
  }
  if (
    !["ordinary_food", "nonalcoholic_drink"].includes(kind.choice) &&
    effectConfidence < MIN_EFFECT_CONFIDENCE
  ) {
    return {
      analysis: null,
      fastPathEligible: false,
      fallbackReason: "low_effect_confidence",
      requestedModel: result.requestedModel,
      actualModel: result.actualModel,
      providerRequestId: result.providerRequestId,
      latencyMs: result.latencyMs,
    };
  }

  const availableUnits = Math.max(1, Math.floor(candidate.quantity ?? 1));
  const modeledUnits = Math.max(1, Math.min(units, availableUnits, 5));
  const potency = boundedScore(potencyAnswer.score);
  const risk = boundedScore(riskAnswer.score);
  const effects = deterministicEffects({
    substanceKind: kind.choice,
    effectProfile: profile,
    potency,
    risk,
    units: modeledUnits,
    freshness: freshness.choice,
  });
  const materialization =
    candidate.sourceType === "ambient_pool"
      ? {
          name: candidate.name,
          conceptSummary: candidate.description,
          descriptiveTraits: [kind.choice, profile],
          unitsCreated: modeledUnits,
        }
      : undefined;

  const analysis = validateConsumableAnalysisAgainstContext(
    ConsumableAnalysisSchema.parse({
      selection: {
        sourceType: candidate.sourceType,
        sourceId: candidate.sourceId,
        displayName: candidate.name,
        rationale: "Jev selected this supplied source above the semantic decision threshold.",
        confidence: sourceConfidence,
      },
      classification: {
        consumable: true,
        substanceKind: kind.choice,
        portionDescription:
          modeledUnits === 1 ? "one bounded serving" : `${modeledUnits} bounded servings`,
        freshnessAssessment: freshness.choice,
        confidence: Math.min(booleanConfidence, Math.max(effectConfidence, MIN_EFFECT_CONFIDENCE)),
      },
      requestedUnits: units,
      consumeUnits: modeledUnits,
      materialization,
      ...effects,
      narrationFacts: [
        `${modeledUnits} unit${modeledUnits === 1 ? "" : "s"} of ${candidate.name} can be consumed.`,
        `Jev classified the dominant effect as ${profile} at potency band ${potency} with risk band ${risk}.`,
      ],
      assumptions: [
        "Jev selected bounded semantic categories; deterministic code derived all resource, condition, risk-probability, and random-outcome mechanics.",
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
