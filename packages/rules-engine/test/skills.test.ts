import { describe, expect, it } from "vitest";
import {
  xpForLevel,
  levelFromXp,
  getSkillLevel,
  applySkillXp,
  creationTimeMultiplier,
} from "../src/skills";

describe("xpForLevel", () => {
  it("returns N²×10 XP", () => {
    expect(xpForLevel(0)).toBe(0);
    expect(xpForLevel(1)).toBe(10);
    expect(xpForLevel(10)).toBe(1000);
    expect(xpForLevel(50)).toBe(25000);
    expect(xpForLevel(100)).toBe(100000);
  });
  it("rejects out of range", () => {
    expect(() => xpForLevel(-1)).toThrow();
    expect(() => xpForLevel(101)).toThrow();
  });
});

describe("levelFromXp", () => {
  it("clamps and floors correctly", () => {
    expect(levelFromXp(0)).toBe(0);
    expect(levelFromXp(9)).toBe(0);
    expect(levelFromXp(10)).toBe(1);
    expect(levelFromXp(25000)).toBe(50);
    expect(levelFromXp(99999)).toBe(99);
    expect(levelFromXp(100000)).toBe(100);
    expect(levelFromXp(999999)).toBe(100);
  });
});

describe("getSkillLevel", () => {
  it("reads from state.skills JSONB", () => {
    expect(getSkillLevel({}, "engineering")).toBe(0);
    expect(getSkillLevel({ skills: { engineering: 25000 } }, "engineering")).toBe(50);
    expect(getSkillLevel({ skills: {} }, "combat")).toBe(0);
  });
});

describe("applySkillXp", () => {
  it("mutates state and reports level-ups with cumulative small gains", () => {
    const state: Record<string, unknown> = {};
    expect(applySkillXp(state, "engineering", 5)).toEqual({ xp: 5, level: 0, leveledUp: false });
    expect(applySkillXp(state, "engineering", 5)).toEqual({ xp: 10, level: 1, leveledUp: true });
    expect(getSkillLevel(state, "engineering")).toBe(1);
    // 10 more XP — still level 1 (20 total)
    expect(applySkillXp(state, "engineering", 10)).toEqual({ xp: 20, level: 1, leveledUp: false });
    // XP gains are 1-10 per action; level 50 requires ~834 actions
  });
  it("rejects invalid XP", () => {
    expect(() => applySkillXp({}, "engineering", 0)).toThrow();
    expect(() => applySkillXp({}, "engineering", 11)).toThrow();
  });
});

describe("creationTimeMultiplier", () => {
  it("returns 1× when skill meets difficulty", () => {
    expect(creationTimeMultiplier(50, 50)).toBe(1);
    expect(creationTimeMultiplier(100, 50)).toBe(1);
  });
  it("scales with gap", () => {
    expect(creationTimeMultiplier(40, 50)).toBe(3);
    expect(creationTimeMultiplier(30, 50)).toBe(3);
    expect(creationTimeMultiplier(10, 50)).toBe(10);
    expect(creationTimeMultiplier(10, 60)).toBe(50);  // gap=50 → 50×
  });
  it("explodes for huge gaps (nuke scenario)", () => {
    const mult = creationTimeMultiplier(0, 95);
    expect(mult).toBeGreaterThan(500);
    expect(mult).toBeLessThan(5000);
  });
});
