// ponytail: skills live in entity_instances.state.skills JSONB.
// Skill level = floor(sqrt(xp / 10)), clamped to [0, 100].
// XP per action = action difficulty (1-10), determined by AI.

export const SKILL_NAMES = [
  "engineering",
  "chemistry",
  "electronics",
  "mechanics",
  "medicine",
  "combat",
  "stealth",
  "investigation",
  "persuasion",
  "driving",
  "hacking",
  "athletics",
  "streetwise",
] as const;

export type SkillName = (typeof SKILL_NAMES)[number];

export const MAX_SKILL_LEVEL = 100;
const XP_PER_LEVEL_MULTIPLIER = 10;

/** Total XP needed to reach exactly `level` (0-100). */
export function xpForLevel(level: number): number {
  if (level < 0 || level > MAX_SKILL_LEVEL) throw new Error("Level out of range.");
  return level * level * XP_PER_LEVEL_MULTIPLIER;
}

/** Current skill level derived from total accumulated XP. */
export function levelFromXp(xp: number): number {
  return Math.min(MAX_SKILL_LEVEL, Math.max(0, Math.floor(Math.sqrt(Math.max(0, xp) / XP_PER_LEVEL_MULTIPLIER))));
}

/** Read a character's skill level from their entity state. */
export function getSkillLevel(
  state: Record<string, unknown>,
  skill: SkillName,
): number {
  const skills = (state.skills as Record<string, number> | undefined) ?? {};
  return levelFromXp(skills[skill] ?? 0);
}

/** Read all skill levels from entity state. */
export function getAllSkillLevels(state: Record<string, unknown>): Record<SkillName, number> {
  const skills = (state.skills as Record<string, number> | undefined) ?? {};
  return Object.fromEntries(SKILL_NAMES.map((s) => [s, levelFromXp(skills[s] ?? 0)])) as Record<SkillName, number>;
}

/** Return the XP delta and resulting level after an action.
 *  Returns null if XP hasn't changed. */
export function applySkillXp(
  state: Record<string, unknown>,
  skill: SkillName,
  xpGain: number,
): { xp: number; level: number; leveledUp: boolean } | null {
  if (xpGain < 1 || xpGain > 10) throw new Error("XP gain must be 1-10.");
  const skills = { ...((state.skills as Record<string, number> | undefined) ?? {}) };
  const oldXp = skills[skill] ?? 0;
  const oldLevel = levelFromXp(oldXp);
  const newXp = oldXp + xpGain;
  const newLevel = levelFromXp(newXp);
  if (newLevel === oldLevel && newXp === oldXp) return null;
  skills[skill] = newXp;
  state.skills = skills;
  return { xp: newXp, level: newLevel, leveledUp: newLevel > oldLevel };
}

/** How much time multiplier to apply for a skill gap on item creation.
 *  skill >= difficulty → 1×
 *  skill ≥ diff − 20 → 3×
 *  skill ≥ diff − 40 → 10×
 *  skill ≥ diff − 60 → 50×
 *  otherwise → exponentially impractical */
export function creationTimeMultiplier(skillLevel: number, difficulty: number): number {
  const gap = difficulty - skillLevel;
  if (gap <= 0) return 1;
  if (gap <= 20) return 3;
  if (gap <= 40) return 10;
  if (gap <= 60) return 50;
  // Beyond 60-point gap: doubles every additional 10 points of gap
  return 50 * Math.pow(2, (gap - 60) / 10);
}
