export const FACTIONS = ["police", "yakuza", "corporate", "underground"] as const;
export type FactionId = (typeof FACTIONS)[number];

/** Standing shift for an action toward a faction (-20..20). */
export function factionShift(
  actionType: string,
  outcome: "good" | "bad" | "neutral" = "neutral",
): Partial<Record<FactionId, number>> {
  const m: Partial<Record<FactionId, number>> = {};
  const sign = outcome === "good" ? 1 : outcome === "bad" ? -1 : 0;
  if (actionType === "arrest" || actionType === "talk") {
    // talk alone is neutral
  }
  if (["steal", "attack", "hack", "plant"].includes(actionType)) {
    m.police = -3 * (sign === 0 ? 1 : sign === 1 ? 0.5 : 1.5);
    m.underground = 2;
    m.yakuza = actionType === "steal" ? 1 : 0;
  }
  if (actionType === "bribe") {
    m.police = -1;
    m.corporate = 1;
  }
  if (actionType === "heal") {
    m.underground = 1;
  }
  // clamp-ish round
  for (const k of Object.keys(m) as FactionId[]) {
    m[k] = Math.round(m[k]!);
  }
  return m;
}

export function applyStanding(
  current: Record<string, number>,
  delta: Partial<Record<FactionId, number>>,
): Record<string, number> {
  const next = { ...current };
  for (const [k, v] of Object.entries(delta)) {
    const n = (next[k] ?? 0) + (v ?? 0);
    next[k] = Math.max(-100, Math.min(100, n));
  }
  return next;
}

/** Item gated if requiredFaction standing < minStanding. */
export function factionAllows(
  standing: Record<string, number>,
  requiredFaction?: string,
  minStanding = 0,
): boolean {
  if (!requiredFaction) return true;
  return (standing[requiredFaction] ?? 0) >= minStanding;
}
