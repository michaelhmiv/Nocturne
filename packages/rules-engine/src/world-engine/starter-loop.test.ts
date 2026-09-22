import { describe, expect, it } from "vitest";
import { EngineIntentSchema, stockForFamily } from "@nocturne/contracts";
import { createWorldEngine } from "./decide.js";
import { interiorForSource } from "./interiors.js";
import { createMemoryPorts } from "./memory-ports.js";
import { OSM_STARTER_POINT } from "./osm-manhattan-fixture.js";
import type { ActorSnapshot } from "./ports.js";

const WORLD = "11111111-1111-4111-8111-111111111111";
const SHARD = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const REQUEST = "44444444-4444-4444-8444-444444444444";
const SANDWICH = "55555555-5555-4555-8555-555555555555";

const actor: ActorSnapshot = {
  actorId: ACTOR,
  worldId: WORLD,
  shardId: SHARD,
  locationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  lon: OSM_STARTER_POINT.lon,
  lat: OSM_STARTER_POINT.lat,
  version: 1,
  possessedIds: [SANDWICH],
  restrained: false,
  conscious: true,
};

describe("starter sitting", () => {
  it("walks a bound bodega, lists family stock, enters front, then eats", async () => {
    const engine = createWorldEngine(
      createMemoryPorts({
        actors: [actor],
        known: [],
        sources: [
          {
            sourceKey: "osm:node:14th-convenience",
            family: "place.retail.food",
            name: "East 14th Convenience",
            distanceMeters: 80,
            lon: OSM_STARTER_POINT.lon + 0.001,
            lat: OSM_STARTER_POINT.lat,
            known: false,
            playable: false,
          },
        ],
      }),
    );
    const travel = await engine.decide(
      EngineIntentSchema.parse({
        worldId: WORLD,
        shardId: SHARD,
        actorId: ACTOR,
        requestId: REQUEST,
        primitive: "travel",
        category: "place.retail.food",
        selector: "nearest",
        rawText: "go to the nearest grocery store",
      }),
    );
    expect(travel.status).toBe("materialize_from_source");
    expect(travel.operations.some((op) => op.type === "move_entity")).toBe(true);
    expect(stockForFamily("place.retail.food").map((slot) => slot.sku)).toContain("sandwich");
    expect(interiorForSource("osm:node:14th-convenience").rooms[1]?.roomKey).toBe(
      "osm:node:14th-convenience#front",
    );
    const eat = await engine.decide(
      EngineIntentSchema.parse({
        worldId: WORLD,
        shardId: SHARD,
        actorId: ACTOR,
        requestId: REQUEST,
        primitive: "consume",
        category: "item.consumable",
        explicitEntityIds: [SANDWICH],
        rawText: "eat the sandwich",
      }),
    );
    expect(eat.operations[0]).toMatchObject({ type: "adjust_resource", resource: "nutrition" });
  });
});
