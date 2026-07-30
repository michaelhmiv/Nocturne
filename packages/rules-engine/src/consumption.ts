import type {
  ConsumableAnalysis,
  ConsumptionConditionEffect,
  ConsumptionResourceDelta,
} from "@nocturne/contracts";
import type { OutcomeGrade } from "@nocturne/contracts";

export interface AppliedConsumptionRisk {
  description: string;
  occurred: boolean;
}

export interface ConsumptionMechanicsResult {
  outcomeGrade: OutcomeGrade;
  resourceDeltas: ConsumptionResourceDelta[];
  conditions: ConsumptionConditionEffect[];
  risks: AppliedConsumptionRisk[];
  calculationTrace: string[];
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function randomFor(seed: string, index: number): number {
  let value = hashSeed(`${seed}:consumption-risk:${index}`) + 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function assertEffectBudget(analysis: ConsumableAnalysis) {
  const directMagnitude = analysis.resourceDeltas.reduce(
    (sum, effect) => sum + Math.abs(effect.delta),
    0,
  );
  const conditionMagnitude = analysis.conditions.reduce(
    (sum, effect) => sum + Math.abs(effect.intensity),
    0,
  );
  if (directMagnitude > 80) {
    throw new Error("Consumption resource effects exceed the deterministic magnitude budget.");
  }
  if (conditionMagnitude > 30) {
    throw new Error("Consumption conditions exceed the deterministic magnitude budget.");
  }
  for (const risk of analysis.risks) {
    const riskMagnitude = risk.resourceDeltas.reduce(
      (sum, effect) => sum + Math.abs(effect.delta),
      0,
    );
    if (riskMagnitude > 50) {
      throw new Error("A consumption risk exceeds the deterministic magnitude budget.");
    }
  }
}

export function resolveConsumptionMechanics(
  analysis: ConsumableAnalysis,
  seed: string,
): ConsumptionMechanicsResult {
  if (!seed.trim()) throw new Error("A server seed is required for consumption resolution.");
  assertEffectBudget(analysis);

  if (analysis.selection.sourceType === "none") {
    return {
      outcomeGrade: "failure",
      resourceDeltas: [],
      conditions: [],
      risks: [],
      calculationTrace: ["consume_source=none", "consume_outcome=failure"],
    };
  }
  if (!analysis.classification.consumable) {
    return {
      outcomeGrade: "failure",
      resourceDeltas: [],
      conditions: [],
      risks: [],
      calculationTrace: [
        `consume_source=${analysis.selection.sourceType}`,
        "consume_classification=not_consumable",
        "consume_outcome=failure",
      ],
    };
  }

  const resourceDeltas = [...analysis.resourceDeltas];
  const conditions = [...analysis.conditions];
  const risks = analysis.risks.map((risk, index) => {
    const rollBasisPoints = Math.floor(randomFor(seed, index) * 10_000);
    const occurred = rollBasisPoints < risk.chanceBasisPoints;
    if (occurred) {
      resourceDeltas.push(...risk.resourceDeltas);
      conditions.push(...risk.conditions);
    }
    return {
      description: risk.description,
      occurred,
      rollBasisPoints,
      chanceBasisPoints: risk.chanceBasisPoints,
    };
  });
  const consequence = risks.some((risk) => risk.occurred);

  return {
    outcomeGrade: consequence ? "success_with_consequence" : "complete_success",
    resourceDeltas,
    conditions,
    risks: risks.map(({ description, occurred }) => ({ description, occurred })),
    calculationTrace: [
      `consume_source=${analysis.selection.sourceType}`,
      `consume_name=${analysis.selection.displayName}`,
      `consume_units=${analysis.consumeUnits}`,
      `consume_resource_effects=${resourceDeltas.length}`,
      `consume_conditions=${conditions.length}`,
      ...risks.map(
        (risk, index) =>
          `consume_risk_${index}=${risk.rollBasisPoints}/${risk.chanceBasisPoints}:${risk.occurred}`,
      ),
      `consume_outcome=${consequence ? "success_with_consequence" : "complete_success"}`,
    ],
  };
}
