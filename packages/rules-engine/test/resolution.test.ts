import { describe, expect, it } from "vitest";
import { outcomeForMargin, resolveContest } from "../src/index.js";

describe("outcomeForMargin", () => {
  it("preserves outcome boundaries", () => {
    expect(outcomeForMargin(6)).toBe("complete_success");
    expect(outcomeForMargin(3)).toBe("success_with_consequence");
    expect(outcomeForMargin(0)).toBe("partial_success");
    expect(outcomeForMargin(-1)).toBe("failure_with_progress");
    expect(outcomeForMargin(-4)).toBe("failure");
    expect(outcomeForMargin(-7)).toBe("catastrophic_reversal");
  });
});

describe("resolveContest", () => {
  it("is deterministic for a fixed seed", () => {
    const input = { actorScore: 5, targetScore: 4, seed: "event-123" };
    expect(resolveContest(input)).toEqual(resolveContest(input));
  });
});
