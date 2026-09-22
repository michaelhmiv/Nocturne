import { describe, expect, it } from "vitest";
import { EngineIntentSchema } from "@nocturne/contracts";
import { createWorldEngine } from "./decide.js";
import { createMemoryPorts } from "./memory-ports.js";
import type { ActorSnapshot } from "./ports.js";

const WORLD = "11111111-1111-4111-8111-111111111111";
const SHARD = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const REQUEST = "44444444-4444-4444-8444-444444444444";

const actor: ActorSnapshot = {
  actorId: ACTOR,
  worldId: WORLD,
  shardId: SHARD,
  locationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  lon: -73.99,
  lat: 40.735,
  version: 1,
  possessedIds: [],
  restrained: false,
  conscious: true,
};

describe("build-out 2 place contents", () => {
  it("materializes rooms, stock, and a clerk with the bodega", async () => {
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
            known: false,
            playable: false,
          },
        ],
      }),
    );
    const decision = await engine.decide(
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
    const symbols = decision.operations
      .filter((op) => op.type === "create_instance")
      .map((op) => ("symbol" in op ? op.symbol : ""));
    expect(symbols).toEqual(
      expect.arrayContaining(["destination", "front", "counter", "street_door", "stock_0", "clerk"]),
    );
    expect(decision.operations.some((op) => op.type === "move_entity")).toBe(true);
  });
});
