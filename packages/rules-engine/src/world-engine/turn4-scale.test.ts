import { describe, expect, it } from "vitest";
import { EngineIntentSchema, inventedSuccess } from "@nocturne/contracts";
import { createWorldEngine } from "./decide.js";
import { extractProvenance, OSM_EXTRACT_VERSION } from "./extract-version.js";
import { createMemoryPorts } from "./memory-ports.js";
import type { ActorSnapshot, WorldCandidate } from "./ports.js";

const WORLD_A = "11111111-1111-4111-8111-111111111111";
const WORLD_B = "99999999-9999-4999-8999-999999999999";
const SHARD = "22222222-2222-4222-8222-222222222222";
const ACTOR_A = "33333333-3333-4333-8333-333333333333";
const ACTOR_B = "44444444-4444-4444-8444-444444444444";
const REQUEST = "55555555-5555-4555-8555-555555555555";
const UNIT = "66666666-6666-4666-8666-666666666666";

function actor(id: string, worldId: string): ActorSnapshot {
  return {
    actorId: id,
    worldId,
    shardId: SHARD,
    locationId: UNIT,
    lon: -73.99,
    lat: 40.735,
    version: 1,
    possessedIds: [],
    restrained: false,
    conscious: true,
  };
}

describe("build-out 4 scale and isolation", () => {
  it("pins the starter city to a versioned extract", () => {
    expect(OSM_EXTRACT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(extractProvenance().license).toBe("ODbL");
  });

  it("lets two bodies occupy the same unit without sharing inventory", async () => {
    const unit: WorldCandidate = {
      entityId: UNIT,
      worldId: WORLD_A,
      shardId: SHARD,
      family: "place.interior",
      name: "studio",
      distanceMeters: 0,
      known: true,
      playable: true,
    };
    const engine = createWorldEngine(
      createMemoryPorts({
        actors: [actor(ACTOR_A, WORLD_A), actor(ACTOR_B, WORLD_A)],
        known: [unit],
        sources: [],
      }),
    );
    const first = await engine.decide(
      EngineIntentSchema.parse({
        worldId: WORLD_A,
        shardId: SHARD,
        actorId: ACTOR_A,
        requestId: REQUEST,
        primitive: "occupy",
        category: "place.interior",
        explicitEntityIds: [UNIT],
        rawText: "sit in the studio",
      }),
    );
    const second = await engine.decide(
      EngineIntentSchema.parse({
        worldId: WORLD_A,
        shardId: SHARD,
        actorId: ACTOR_B,
        requestId: "77777777-7777-4777-8777-777777777777",
        primitive: "occupy",
        category: "place.interior",
        explicitEntityIds: [UNIT],
        rawText: "sit in the studio",
      }),
    );
    expect(first.operations[0]).toMatchObject({ relationType: "seated_in" });
    expect(second.operations[0]).toMatchObject({ relationType: "seated_in" });
    expect(inventedSuccess(first)).toBe(false);
  });

  it("does not lease a unit from world B into world A", async () => {
    const foreignUnit: WorldCandidate = {
      entityId: UNIT,
      worldId: WORLD_B,
      shardId: SHARD,
      family: "place.interior",
      name: "studio",
      distanceMeters: 0,
      known: true,
      playable: true,
    };
    const engine = createWorldEngine(
      createMemoryPorts({
        actors: [actor(ACTOR_A, WORLD_A)],
        known: [foreignUnit],
        sources: [],
      }),
    );
    const decision = await engine.decide(
      EngineIntentSchema.parse({
        worldId: WORLD_A,
        shardId: SHARD,
        actorId: ACTOR_A,
        requestId: REQUEST,
        primitive: "occupy",
        category: "place.interior",
        rawText: "lease the studio",
      }),
    );
    expect(decision.status).toBe("need_source");
    expect(decision.operations).toEqual([]);
  });
});
