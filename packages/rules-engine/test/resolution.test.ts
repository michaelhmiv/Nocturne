import { describe, expect, it } from "vitest";
import { outcomeForMargin, resolveContest } from "../src/index.js";

const actionTypes = [
  "detection",
  "investigation",
  "social_persuasion",
  "physical_conflict",
  "property_installation",
  "crafting_invention",
];

describe("outcomeForMargin", () => {
  it("preserves default outcome boundaries", () => {
    expect(outcomeForMargin(6)).toBe("complete_success");
    expect(outcomeForMargin(3)).toBe("success_with_consequence");
    expect(outcomeForMargin(0)).toBe("partial_success");
    expect(outcomeForMargin(-1)).toBe("failure_with_progress");
    expect(outcomeForMargin(-4)).toBe("failure");
    expect(outcomeForMargin(-7)).toBe("catastrophic_reversal");
  });

  it("accepts configurable outcome bands", () => {
    expect(
      outcomeForMargin(2, [
        { minimumMargin: 2, grade: "complete_success" },
        { minimumMargin: Number.NEGATIVE_INFINITY, grade: "failure" },
      ]),
    ).toBe("complete_success");
  });
});

describe("resolveContest", () => {
  it("is deterministic for a fixed server seed", () => {
    const input = {
      actionType: "detection",
      actorScore: 5,
      targetScore: 4,
      seed: "server:event-123",
    };
    expect(resolveContest(input)).toEqual(resolveContest(input));
    expect(resolveContest(input).calculationTrace).toEqual(
      expect.arrayContaining([expect.stringMatching(/^seed_hash=\d+$/), "uncertainty_range=3"]),
    );
  });

  it("rejects malformed authoritative inputs", () => {
    expect(() =>
      resolveContest({ actionType: "", actorScore: 5, targetScore: 4, seed: "server:event" }),
    ).toThrow(/action type/i);
    expect(() =>
      resolveContest({
        actionType: "detection",
        actorScore: Number.NaN,
        targetScore: 4,
        seed: "server:event",
      }),
    ).toThrow(/score/i);
    expect(() =>
      resolveContest({ actionType: "detection", actorScore: 5, targetScore: 4, seed: "" }),
    ).toThrow(/seed/i);
  });

  it.each(actionTypes)("resolves auditable non-prescriptive %s actions", (actionType) => {
    const result = resolveContest({
      actionType,
      actorScore: 5,
      targetScore: 4,
      seed: `server:${actionType}`,
    });

    expect(result.calculationTrace).toEqual(
      expect.arrayContaining([`action=${actionType}`, expect.stringMatching(/^outcome_band=/)]),
    );
    expect(result).not.toHaveProperty("narration");
  });

  it("rejects out-of-bounds and aggregate AI modifiers", () => {
    expect(() =>
      resolveContest({
        actionType: "investigation",
        actorScore: 5,
        targetScore: 4,
        seed: "server:invalid-modifier",
        modifiers: [{ factorId: "ai", value: 6, reason: "unbounded proposal" }],
      }),
    ).toThrow(/modifier/i);

    expect(() =>
      resolveContest({
        actionType: "investigation",
        actorScore: 5,
        targetScore: 4,
        seed: "server:aggregate-modifier",
        modifiers: [
          { factorId: "ai-1", value: 5, reason: "proposal one" },
          { factorId: "ai-2", value: 5, reason: "proposal two" },
          { factorId: "ai-3", value: 5, reason: "proposal three" },
        ],
      }),
    ).toThrow(/total/i);
  });
});
