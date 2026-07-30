import { describe, expect, it } from "vitest";
import { deterministicActionFallback } from "./action-adjudicator.js";

describe("routine consumption intent", () => {
  it.each([
    "I eat food",
    "I want to eat a cake",
    "I drink some water",
    "I have a snack",
    "I swallow the pill",
  ])("normalizes %s as a consume action", (rawText) => {
    const parsed = deterministicActionFallback(
      { actorId: "actor-1", rawText },
      "BARE-ACTION",
      "location-1",
    );

    expect(parsed.intent.actionType).toBe("consume");
    expect(parsed.intent.objective).toBe(rawText);
  });

  it("keeps actual medical treatment separate", () => {
    const parsed = deterministicActionFallback(
      { actorId: "actor-1", rawText: "I bandage the cut" },
      "BARE-ACTION",
      "location-1",
    );

    expect(parsed.intent.actionType).toBe("heal");
  });
});
