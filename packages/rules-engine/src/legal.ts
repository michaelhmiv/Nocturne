import type { OutcomeGrade } from "@nocturne/contracts";

export const CRIMINAL_ACTIONS = new Set([
  "steal",
  "attack",
  "hack",
  "lockpick",
  "plant",
  "forge",
]);

/** Heat gain 0-20 from crime outcome. */
export function heatFromCrime(actionType: string, outcome: OutcomeGrade): number {
  if (!CRIMINAL_ACTIONS.has(actionType)) return 0;
  const base =
    actionType === "attack" ? 8 : actionType === "steal" ? 5 : actionType === "hack" ? 6 : 4;
  switch (outcome) {
    case "complete_success":
      return Math.max(1, Math.floor(base * 0.5)); // clean job
    case "success_with_consequence":
      return base;
    case "partial_success":
      return base + 2;
    case "failure_with_progress":
      return base + 4;
    case "failure":
      return base + 6;
    case "catastrophic_reversal":
      return base + 12;
    default:
      return base;
  }
}

/** Warrant threshold. */
export const WARRANT_HEAT = 40;
/** Auto-jail if heat exceeds this and warrant active. */
export const ARREST_HEAT = 70;

export function legalStatusAfterHeat(heat: number, hadWarrant: boolean): {
  heat: number;
  warrant: boolean;
  jailed: boolean;
  jailSeconds: number;
} {
  const warrant = hadWarrant || heat >= WARRANT_HEAT;
  const jailed = warrant && heat >= ARREST_HEAT;
  return {
    heat: Math.min(100, heat),
    warrant,
    jailed,
    jailSeconds: jailed ? Math.min(3600, 300 + (heat - ARREST_HEAT) * 30) : 0,
  };
}
