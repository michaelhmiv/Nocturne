import { describe, expect, it } from "vitest";
import { GameMasterContextSchema } from "./game-master-context.js";

const actorId = "10000000-0000-4000-8000-000000000001";
const locationId = "10000000-0000-4000-8000-000000000002";
const requestId = "10000000-0000-4000-8000-000000000003";
const eventId = "10000000-0000-4000-8000-000000000004";
const memoryId = "10000000-0000-4000-8000-000000000005";

const constitution = {
  version: "gm-constitution-v1",
  purpose: ["Resolve open-ended player actions in a causally persistent world."],
  improvisationRules: ["Accept harmless mundane premises when plausible."],
  persistenceRules: ["Persist consequences and identity, not every noun."],
  authorityRules: ["Do not create valuable advantages without authoritative support."],
  toneRules: ["Treat absurd actions as valid roleplaying opportunities."],
};

describe("game master context", () => {
  it("accepts bounded player-safe narrative context", () => {
    const parsed = GameMasterContextSchema.parse({
      constitution,
      currentCommand: "I eat gum off a light pole.",
      currentScene: {
        locationId,
        locationName: "Foundry Row",
        locationDescription: "An ordinary urban street.",
        summary: "The player is standing near the curb after eating oatmeal.",
        unresolvedThreads: [],
      },
      recentTurns: [
        {
          requestId,
          command: "I eat food yummy.",
          playerSafeResult: "You eat an instant oatmeal packet.",
          eventIds: [eventId],
          occurredAt: "2026-08-01T12:00:00.000Z",
        },
      ],
      relevantMemories: [
        {
          memoryId,
          summary: "The player recently ate an oatmeal packet.",
          sourceEventIds: [eventId],
          mentionedEntityIds: [actorId],
          locationId,
          salience: 8_000,
          visibility: "player_known",
          unresolved: false,
          occurredAt: "2026-08-01T12:00:00.000Z",
        },
      ],
      playerKnownFacts: [
        {
          factId: "fact:actor-location",
          entityId: actorId,
          claim: "entity.location",
          value: locationId,
          visibility: "player_known",
          provenance: { kind: "world_state", sourceId: actorId },
          relevanceScore: 100_000,
          inclusionReasons: ["actor"],
        },
      ],
      activePlan: null,
      estimatedTokens: 1_200,
    });

    expect(parsed.currentScene.locationName).toBe("Foundry Row");
    expect(parsed.recentTurns).toHaveLength(1);
  });

  it("rejects hidden memories from the player-safe context", () => {
    expect(() =>
      GameMasterContextSchema.parse({
        constitution,
        currentCommand: "I look around.",
        currentScene: {
          locationId,
          locationName: "Foundry Row",
          locationDescription: "An ordinary urban street.",
          summary: "The player is standing near the curb.",
          unresolvedThreads: [],
        },
        recentTurns: [],
        relevantMemories: [
          {
            memoryId,
            summary: "A hidden observer is watching.",
            sourceEventIds: [eventId],
            mentionedEntityIds: [],
            locationId,
            salience: 5_000,
            visibility: "authoritative_hidden",
            unresolved: true,
            occurredAt: "2026-08-01T12:00:00.000Z",
          },
        ],
        playerKnownFacts: [],
        activePlan: null,
        estimatedTokens: 200,
      }),
    ).toThrow();
  });
});
