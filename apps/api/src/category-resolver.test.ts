import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { STARTER_FOUNDRY_ROW_PLACES } from "@nocturne/contracts";
import { destinationIdFromResolution, resolveCommandDestination } from "./category-resolver.js";

describe("command destination resolver", () => {
  it("binds the seeded bodega for grocery language", () => {
    const actorId = randomUUID();
    const result = resolveCommandDestination({
      command: "go to the nearest grocery store",
      actorId,
      context: {
        compilationId: randomUUID(),
        policyVersion: "test",
        worldId: randomUUID(),
        shardId: randomUUID(),
        viewpointId: actorId,
        commandExcerpt: "go to the nearest grocery store",
        entities: [
          {
            entityId: actorId,
            definitionId: "actor",
            name: "Rook",
            definitionType: "character",
            locationId: STARTER_FOUNDRY_ROW_PLACES.sidewalkId,
            lifecycleStatus: "active",
            version: 1,
            visibility: "player_known",
            relevanceScore: 100,
            inclusionReasons: ["actor"],
          },
        ],
        playerKnownFacts: [],
        authoritativeHiddenFacts: [],
        omittedCandidateCount: 0,
        estimatedTokens: 0,
      },
    });
    expect(result?.status).toBe("bound");
    expect(destinationIdFromResolution(result!)).toBe(STARTER_FOUNDRY_ROW_PLACES.bodegaId);
  });
});
