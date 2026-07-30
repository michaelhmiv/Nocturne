import { describe, expect, it } from "vitest";
import {
  buildCombatOperations,
  creationTimeMultiplier,
  npcDialogue,
  xpFromOutcome,
} from "../src/index.js";

describe("phase3 combat", () => {
  it("catastrophic attack downs actor and flags death", () => {
    const ops = buildCombatOperations({
      outcome: "catastrophic_reversal",
      actorId: "a",
      targetId: "t",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    expect(ops.some((o) => o.type === "set_instance_state" && o.path?.[0] === "pendingDeath")).toBe(
      true,
    );
  });

  it("success damages target", () => {
    const ops = buildCombatOperations({
      outcome: "complete_success",
      actorId: "a",
      targetId: "t",
      occurredAt: "2026-01-01T00:00:00.000Z",
    });
    expect(ops.some((o) => o.type === "change_instance_condition" && o.instanceId === "t")).toBe(
      true,
    );
  });
});

describe("phase3 xp", () => {
  it("maps outcomes to 1-5 xp", () => {
    expect(xpFromOutcome("complete_success")).toBe(5);
    expect(xpFromOutcome("failure")).toBe(1);
  });
});

describe("phase3 npc", () => {
  it("returns dialogue", () => {
    const d = npcDialogue({
      npcName: "Rook",
      schedule: { day: "the docks" },
      rawText: "hey",
      outcome: "complete_success",
    });
    expect(d.speaker).toBe("Rook");
    expect(d.line).toContain("Rook");
  });
});

describe("phase3 craft gate", () => {
  it("multiplies time with skill gap", () => {
    expect(creationTimeMultiplier(50, 50)).toBe(1);
    expect(creationTimeMultiplier(30, 50)).toBe(3);
    expect(creationTimeMultiplier(0, 80)).toBeGreaterThan(50);
  });
});
