import { describe, expect, it } from "vitest";
import { SceneProjectionSchema } from "../src/index.js";

describe("SceneProjectionSchema", () => {
  it("accepts a player-safe location projection", () => {
    const scene = SceneProjectionSchema.parse({
      character: {
        characterId: "10000000-0000-4000-8000-000000000001",
        name: "Mara Vale",
        conceptSummary: "A former investigator working the Foundry Row night shift.",
        cashOnPerson: 2500,
        heat: 4,
        warrant: false,
        status: "active",
      },
      location: {
        locationId: "10000000-0000-4000-8000-000000000002",
        name: "Unit 3B",
        area: "Foundry Row",
        atmosphere: "Low industrial light reaches through the blinds.",
      },
      visibleEntities: [
        {
          instanceId: "10000000-0000-4000-8000-000000000003",
          name: "Unknown courier",
          relationship: "visible",
        },
      ],
      ownedEntities: [],
      discoveries: ["A delivery was made behind the building after midnight."],
      opportunities: [
        {
          opportunityId: "observe:courier",
          label: "Watch the courier",
          suggestedAction: "I quietly watch the courier from the window.",
        },
      ],
      generatedAt: "2026-07-30T16:00:00.000Z",
    });

    expect(scene.visibleEntities[0]?.name).toBe("Unknown courier");
  });

  it("does not permit hidden-fact fields in the projection", () => {
    const parsed = SceneProjectionSchema.safeParse({
      character: null,
      location: {
        locationId: null,
        name: "Foundry Row",
        area: "Foundry Row",
        atmosphere: "The street is quiet.",
      },
      visibleEntities: [],
      ownedEntities: [],
      discoveries: [],
      opportunities: [],
      authoritativeHiddenFacts: [{ claim: "npc.intent", value: "ambush" }],
      generatedAt: "2026-07-30T16:00:00.000Z",
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect("authoritativeHiddenFacts" in parsed.data).toBe(false);
    }
  });
});
