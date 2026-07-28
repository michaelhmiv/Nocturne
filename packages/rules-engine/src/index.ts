import type {
  OutcomeGrade,
  ResolutionModifier,
  ResolutionResult,
} from "@nocturne/contracts";

export interface ContestInput {
  actorScore: number;
  targetScore: number;
  modifiers?: ResolutionModifier[];
  seed: string;
  uncertaintyRange?: number;
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

export function outcomeForMargin(margin: number): OutcomeGrade {
  if (margin >= 6) return "complete_success";
  if (margin >= 3) return "success_with_consequence";
  if (margin >= 0) return "partial_success";
  if (margin >= -3) return "failure_with_progress";
  if (margin >= -6) return "failure";
  return "catastrophic_reversal";
}

export function resolveContest(input: ContestInput): ResolutionResult {
  const range = Math.max(0, Math.min(5, input.uncertaintyRange ?? 3));
  const random = nextRandom(hashSeed(input.seed));
  const uncertainty = Math.floor(random * (range * 2 + 1)) - range;
  const modifiers = input.modifiers ?? [];
  const modifierTotal = modifiers.reduce((total, modifier) => total + modifier.value, 0);
  const margin = Math.trunc(input.actorScore - input.targetScore + modifierTotal + uncertainty);

  return {
    outcomeGrade: outcomeForMargin(margin),
    margin,
    uncertainty,
    modifiers,
    calculationTrace: [
      `actor=${input.actorScore}`,
      `target=${input.targetScore}`,
      `modifiers=${modifierTotal}`,
      `uncertainty=${uncertainty}`,
      `margin=${margin}`,
    ],
    stateOperations: [],
    narrativeConstraints: [],
  };
}
