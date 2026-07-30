import type { OutcomeGrade } from "@nocturne/contracts";

/** Comms intercept chance 0-1 from heat + action outcome. */
export function interceptChance(heat: number, outcome: OutcomeGrade): number {
  let p = Math.min(0.85, heat / 120);
  if (outcome === "catastrophic_reversal") p = Math.min(0.95, p + 0.3);
  if (outcome === "failure") p = Math.min(0.9, p + 0.15);
  if (outcome === "complete_success") p = Math.max(0, p - 0.1);
  return p;
}

export function resolveIntercept(
  heat: number,
  outcome: OutcomeGrade,
  roll01: number,
): { intercepted: boolean; chance: number } {
  const chance = interceptChance(heat, outcome);
  return { intercepted: roll01 < chance, chance };
}

export function commsNarration(input: {
  toName: string;
  body: string;
  intercepted: boolean;
}): string {
  if (input.intercepted) {
    return `Your message to ${input.toName} sends, but a click on the line suggests monitoring. "${input.body.slice(0, 120)}"`;
  }
  return `Message delivered to ${input.toName}: "${input.body.slice(0, 120)}"`;
}
