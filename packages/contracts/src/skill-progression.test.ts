import { describe, expect, it } from "vitest";
import { skillLevelForXp, skillProgressForXp, skillXpForLevel } from "./skill-progression.js";

describe("shared skill XP contract", () => {
  it.each([
    [0, 0, 0, 10],
    [9, 0, 0, 10],
    [10, 1, 10, 40],
    [40, 2, 40, 90],
    [90, 3, 90, 160],
    [100_000, 100, 100_000, null],
    [200_000, 100, 100_000, null],
  ])("projects %i XP as level %i", (xp, level, current, next) => {
    expect(skillProgressForXp(xp)).toEqual({
      xp, level, currentLevelXp: current, nextLevelXp: next,
    });
    expect(skillLevelForXp(xp)).toBe(level);
  });

  it("rejects invalid XP and levels", () => {
    for (const value of [-1, Number.NaN, Infinity, 1.5]) {
      expect(() => skillProgressForXp(value)).toThrow();
    }
    expect(() => skillXpForLevel(101)).toThrow();
    expect(() => skillXpForLevel(1.5)).toThrow();
  });
});
