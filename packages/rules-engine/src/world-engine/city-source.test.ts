import { describe, expect, it } from "vitest";
import { EngineIntentSchema, frameFromUtterance } from "@nocturne/contracts";
import { createWorldEngine } from "./decide.js";
import { createMemoryPorts } from "./memory-ports.js";
import { createFeatureSourcePort, pickNearestFeature } from "./city-source.js";
import type { ActorSnapshot } from "./ports.js";

const actor: ActorSnapshot = {
  actorId: "33333333-3333-4333-8333-333333333333",
  worldId: "11111111-1111-4111-8111-111111111111",
  shardId: "22222222-2222-4222-8222-222222222222",
  locationId: "77777777-7777-4777-8777-777777777777",
  lon: -73.99,
  lat: 40.74,
  version: 1,
  possessedIds: [],
  restrained: false,
  conscious: true,
};

const features = [
  {
    sourceKey: "osm:node:1",
    name: "14th Street Bodega",
    lon: -73.991,
    lat: 40.7405,
    properties: { shop: "convenience" },
  },
  {
    sourceKey: "osm:node:2",
    name: "Far Uptown Market",
    lon: -73.96,
    lat: 40.8,
    properties: { shop: "supermarket" },
  },
  {
    sourceKey: "osm:node:3",
    name: "Midtown Fuel",
    lon: -73.989,
    lat: 40.741,
    properties: { amenity: "fuel" },
  },
];

describe("city source port", () => {
  it("maps grocery to the nearest OSM convenience/supermarket, not a seeded name", () => {
    const nearest = pickNearestFeature(features, {
      family: "place.retail.food",
      lon: actor.lon!,
      lat: actor.lat!,
    });
    expect(nearest?.sourceKey).toBe("osm:node:1");
    expect(nearest?.name).toBe("14th Street Bodega");
    expect(nearest?.distanceMeters).toBeLessThan(400);
  });

  it("does not treat a gas station as a grocery", () => {
    const nearest = pickNearestFeature(
      features.filter((feature) => feature.sourceKey === "osm:node:3"),
      { family: "place.retail.food", lon: actor.lon!, lat: actor.lat! },
    );
    expect(nearest).toBeNull();
  });

  it("lets the kernel materialize travel from a feature index", async () => {
    const source = createFeatureSourcePort(features);
    const engine = createWorldEngine({
      query: createMemoryPorts({ actors: [actor], known: [], sources: [] }).query,
      source,
    });
    const frame = frameFromUtterance("go to the nearest grocery store");
    const decision = await engine.decide(
      EngineIntentSchema.parse({
        worldId: actor.worldId,
        shardId: actor.shardId,
        actorId: actor.actorId,
        requestId: "44444444-4444-4444-8444-444444444444",
        primitive: frame!.primitive,
        category: frame!.category,
        selector: frame!.selector,
        travelMode: frame!.travelMode,
        rawText: "go to the nearest grocery store",
      }),
    );
    expect(decision.status).toBe("materialize_from_source");
    expect(decision.requiresClarification).toBe(false);
    expect(decision.target?.sourceKey).toBe("osm:node:1");
    expect(decision.operations.map((operation) => operation.type)).toEqual(
      expect.arrayContaining(["create_instance", "move_entity"]),
    );
  });
});
