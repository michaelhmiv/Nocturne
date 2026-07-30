export * from "./actions.js";
export * from "./combat.js";
export * from "./comms.js";
export * from "./detection-operations.js";
export * from "./factions.js";
export * from "./legal.js";
export * from "./npc.js";
export * from "./probability.js";
export * from "./score-derivation.js";
export * from "./skills.js";

import {
  ResolutionModifierSchema,
  type OutcomeGrade,
  type ResolutionModifier,
  type ResolutionResult,
} from "@nocturne/contracts";

export interface OutcomeBand {
  minimumMargin: number;
  grade: OutcomeGrade;
}
export const defaultOutcomeBands: readonly OutcomeBand[] = [
  { minimumMargin: 6, grade: "complete_success" },
  { minimumMargin: 3, grade: "success_with_consequence" },
  { minimumMargin: 0, grade: "partial_success" },
  { minimumMargin: -3, grade: "failure_with_progress" },
  { minimumMargin: -6, grade: "failure" },
  { minimumMargin: Number.NEGATIVE_INFINITY, grade: "catastrophic_reversal" },
];
export interface ContestInput {
  actionType: string;
  actorScore: number;
  targetScore: number;
  modifiers?: ResolutionModifier[];
  seed: string;
  uncertaintyRange?: number;
  outcomeBands?: readonly OutcomeBand[];
  maxModifierTotal?: number;
}
function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (const character of seed) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function nextRandom(state: number): number {
  let value = state + 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}
export function outcomeForMargin(
  margin: number,
  bands: readonly OutcomeBand[] = defaultOutcomeBands,
): OutcomeGrade {
  if (
    bands.length === 0 ||
    bands.some(
      (band) =>
        (!Number.isFinite(band.minimumMargin) && band.minimumMargin !== Number.NEGATIVE_INFINITY) ||
        !defaultOutcomeBands.some((candidate) => candidate.grade === band.grade),
    )
  )
    throw new Error("Outcome bands are invalid.");
  const band = [...bands]
    .sort((left, right) => right.minimumMargin - left.minimumMargin)
    .find((candidate) => margin >= candidate.minimumMargin);
  if (!band) throw new Error("Outcome bands do not cover this margin.");
  return band.grade;
}
export function resolveContest(input: ContestInput): ResolutionResult {
  if (!input.actionType.trim()) throw new Error("Action type is required.");
  if (!input.seed.trim()) throw new Error("Authoritative server seed is required.");
  if (!Number.isFinite(input.actorScore) || !Number.isFinite(input.targetScore))
    throw new Error("Actor and target scores must be finite numbers.");
  if (input.uncertaintyRange !== undefined && !Number.isFinite(input.uncertaintyRange))
    throw new Error("Uncertainty range must be finite.");
  const parsedModifiers = ResolutionModifierSchema.array().safeParse(input.modifiers ?? []);
  if (!parsedModifiers.success)
    throw new Error(`Invalid resolution modifier: ${parsedModifiers.error.message}`);
  const modifiers = parsedModifiers.data;
  const modifierTotal = modifiers.reduce((total, modifier) => total + modifier.value, 0);
  const maxModifierTotal = input.maxModifierTotal ?? 10;
  if (!Number.isFinite(maxModifierTotal) || maxModifierTotal < 0)
    throw new Error("Modifier bound must be a non-negative finite number.");
  if (Math.abs(modifierTotal) > maxModifierTotal)
    throw new Error(`Modifier total exceeds the allowed bound of ${maxModifierTotal}.`);
  const range = Math.max(0, Math.min(5, input.uncertaintyRange ?? 3));
  const random = nextRandom(hashSeed(input.seed));
  const uncertainty = Math.floor(random * (range * 2 + 1)) - range;
  const margin = Math.trunc(input.actorScore - input.targetScore + modifierTotal + uncertainty);
  const outcomeGrade = outcomeForMargin(margin, input.outcomeBands);
  return {
    outcomeGrade,
    margin,
    uncertainty,
    modifiers,
    calculationTrace: [
      `action=${input.actionType}`,
      `actor=${input.actorScore}`,
      `target=${input.targetScore}`,
      `modifiers=${modifierTotal}`,
      `seed_hash=${hashSeed(input.seed)}`,
      `uncertainty_range=${range}`,
      `uncertainty=${uncertainty}`,
      `margin=${margin}`,
      `outcome_band=${outcomeGrade}`,
    ],
    stateOperations: [],
    narrativeConstraints: [],
  };
}
