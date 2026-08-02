import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { adjudicateActionResolution } from "./resolution-mode-adjudicator.js";
import { deriveSemanticActionFrame } from "./semantic-action-frame.js";

function frame(
  kind: Parameters<typeof deriveSemanticActionFrame>[0]["kind"],
  rawText: string,
  extra = {},
) {
  const actorId = randomUUID();
  return deriveSemanticActionFrame({
    kind,
    actorId,
    rawText,
    payload: { rawText, ...extra },
  });
}

describe("resolution mode adjudicator", () => {
  it("automatically succeeds one ordinary push-up", () => {
    const decision = adjudicateActionResolution(
      frame("interact", "Do one push up"),
    );
    expect(decision.mode).toBe("automatic_success");
    expect(decision.meaningfulUncertainty).toBe(false);
    expect(decision.consequenceLevel).toBe(0);
  });

  it("automatically succeeds another trivial unopposed body action", () => {
    const decision = adjudicateActionResolution(
      frame("interact", "Stand up"),
    );
    expect(decision.mode).toBe("automatic_success");
    expect(decision.difficulty).toBeLessThanOrEqual(2);
  });

  it("uses an unopposed check for demanding self-directed effort", () => {
    const decision = adjudicateActionResolution(
      frame("interact", "Do 100 push-ups until failure"),
    );
    expect(decision.mode).toBe("unopposed_check");
    expect(decision.meaningfulUncertainty).toBe(true);
  });

  it("uses an opposed contest for combat", () => {
    const targetId = randomUUID();
    const actorId = randomUUID();
    const combat = deriveSemanticActionFrame({
      kind: "combat",
      actorId,
      rawText: "Punch the guard",
      payload: { rawText: "Punch the guard", targetId },
      resolvedReferences: { targetId },
    });
    const decision = adjudicateActionResolution(combat);
    expect(decision.mode).toBe("opposed_contest");
    expect(decision.opposition).toBeGreaterThan(0);
  });

  it("uses timed work for a sustained action", () => {
    const decision = adjudicateActionResolution(
      frame("interact", "Exercise for 30 minutes"),
    );
    expect(decision.mode).toBe("timed_task");
  });

  it("automatically fails physically impossible actions without established support", () => {
    const decision = adjudicateActionResolution(
      frame("interact", "Teleport across town"),
    );
    expect(decision.mode).toBe("automatic_failure");
    expect(decision.meaningfulUncertainty).toBe(false);
  });

  it("routes ordinary dialogue without coercion to conversation", () => {
    const decision = adjudicateActionResolution(
      frame("dialogue", "Say hello"),
    );
    expect(decision.mode).toBe("conversation");
  });
});
