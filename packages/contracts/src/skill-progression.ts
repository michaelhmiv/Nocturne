/** The same XP curve governs resolution, persistence projections and the UI. */
export const SKILL_LEVEL_CAP = 100;

export function skillXpForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 0 || level > SKILL_LEVEL_CAP) {
    throw new Error("Skill level out of range.");
  }
  return level * level * 10;
}

export function skillLevelForXp(xp: number): number {
  if (!Number.isFinite(xp)) throw new Error("Skill XP must be finite.");
  return Math.min(SKILL_LEVEL_CAP, Math.floor(Math.sqrt(Math.max(0, xp) / 10)));
}

export function skillProgressForXp(xp: number) {
  if (!Number.isSafeInteger(xp) || xp < 0) throw new Error("Invalid skill XP.");
  const level = skillLevelForXp(xp);
  return {
    xp,
    level,
    currentLevelXp: skillXpForLevel(level),
    nextLevelXp: level === SKILL_LEVEL_CAP ? null : skillXpForLevel(level + 1),
  };
}
