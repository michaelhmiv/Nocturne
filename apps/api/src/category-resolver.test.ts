import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { STARTER_FOUNDRY_ROW_PLACES } from "@nocturne/contracts";
import { destinationIdFromResolution, resolveCommandDestination } from "./category-resolver.js";

function context(actorId: string, locationId: string) {
  return {
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
        locationId,
        lifecycleStatus: "active",
        version: 1,
        visibility: "player_known" as const,
        relevanceScore: 100,
        inclusionReasons: ["actor" as const],
      },
    ],
    playerKnownFacts: [],
    authoritativeHiddenFacts: [],
    omittedCandidateCount: 0,
    estimatedTokens: 0,
  };
}

describe("command destination resolver", () => {
  it("binds the seeded bodega for grocery language", () => {
    const actorId = randomUUID();
    const result = resolveCommandDestination({
      command: "go to the nearest grocery store",
      actorId,
      context: context(actorId, STARTER_FOUNDRY_ROW_PLACES.sidewalkId),
    });
    expect(result?.status).toBe("bound");
    expect(destinationIdFromResolution(result!)).toBe(STARTER_FOUNDRY_ROW_PLACES.bodegaId);
  });

  it("binds the bodega from the starter apartment without asking", () => {
    const actorId = randomUUID();
    const result = resolveCommandDestination({
      command: "go to the nearest grocery store",
      actorId,
      context: context(actorId, STARTER_FOUNDRY_ROW_PLACES.unitId),
    });
    expect(destinationIdFromResolution(result!)).toBe(STARTER_FOUNDRY_ROW_PLACES.bodegaId);
  });
});
