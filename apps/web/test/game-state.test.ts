import { describe, expect, it } from "vitest";
import { buildTimeline } from "../app/game-state";

describe("buildTimeline", () => {
  it("keeps the selected character's inventions in chronological order with actions", () => {
    const timeline = buildTimeline(
      "character-a",
      [
        { characterId: "character-b", createdAt: "2026-01-01T00:00:00.000Z", name: "hidden" },
        { characterId: "character-a", createdAt: "2026-01-03T00:00:00.000Z", name: "visible" },
      ],
      [{ createdAt: "2026-01-02T00:00:00.000Z", name: "action" }],
    );

    expect(timeline.map(({ value }) => value.name)).toEqual(["action", "visible"]);
  });
});
