import { describe, expect, it } from "vitest";
import { RelevanceCompiledContextSchema, RelevanceContextFactSchema } from "./relevance-context.js";

const worldId = "00000000-0000-4000-8000-000000000001";
const shardId = "00000000-0000-4000-8000-000000000002";
const actorId = "10000000-0000-4000-8000-000000000001";
const dogId = "10000000-0000-4000-8000-000000000002";

describe("relevance context contracts", () => {
  it("records why a persistent entity entered context", () => {
    const fact = RelevanceContextFactSchema.parse({
      factId: "context:v1:dog-following",
      entityId: dogId,
      claim: "relationship.following",
      value: actorId,
      visibility: "player_known",
      provenance: { kind: "world_state", sourceId: "relation:dog-following" },
      relevanceScore: 18_000,
      inclusionReasons: ["accompanying", "recent_reference"],
    });

    expect(fact.inclusionReasons).toContain("accompanying");
    expect(fact.relevanceScore).toBeGreaterThan(0);
  });

  it("keeps player-known and hidden facts structurally separate", () => {
    const context = RelevanceCompiledContextSchema.parse({
      compilationId: "20000000-0000-4000-8000-000000000001",
      policyVersion: "relevance-context-v1",
      worldId,
      shardId,
      viewpointId: actorId,
      commandExcerpt: "What is the dog doing?",
      entities: [
        {
          entityId: dogId,
          definitionId: "DOG-MIXED-BREED",
          name: "Thin brown stray",
          definitionType: "animal",
          locationId: "10000000-0000-4000-8000-000000000003",
          lifecycleStatus: "active",
          version: 4,
          visibility: "player_known",
          relevanceScore: 50_000,
          inclusionReasons: ["explicit_reference"],
        },
      ],
      playerKnownFacts: [
        {
          factId: "context:v1:known-location",
          entityId: dogId,
          claim: "entity.location",
          value: "10000000-0000-4000-8000-000000000003",
          visibility: "player_known",
          provenance: { kind: "world_state", sourceId: dogId },
          relevanceScore: 50_000,
          inclusionReasons: ["explicit_reference"],
        },
      ],
      authoritativeHiddenFacts: [
        {
          factId: "context:v1:hidden-fear",
          entityId: dogId,
          claim: "entity.state",
          value: { fear: 63 },
          visibility: "authoritative_hidden",
          provenance: { kind: "character_state", sourceId: dogId },
          relevanceScore: 50_000,
          inclusionReasons: ["explicit_reference"],
        },
      ],
      omittedCandidateCount: 0,
      estimatedTokens: 240,
    });

    expect(context.playerKnownFacts[0]?.claim).toBe("entity.location");
    expect(context.authoritativeHiddenFacts[0]?.visibility).toBe("authoritative_hidden");
  });

  it("rejects context facts without inclusion reasons", () => {
    expect(() =>
      RelevanceContextFactSchema.parse({
        factId: "context:v1:bad",
        claim: "entity.name",
        value: "Dog",
        visibility: "player_known",
        provenance: { kind: "world_state", sourceId: dogId },
        relevanceScore: 1,
        inclusionReasons: [],
      }),
    ).toThrow();
  });
});
