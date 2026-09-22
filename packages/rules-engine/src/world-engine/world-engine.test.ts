import { describe, expect, it } from "vitest";
import {
  EngineIntentSchema,
  frameFromUtterance,
  inventedSuccess,
  primitiveForKind,
  type EngineIntent,
} from "@nocturne/contracts";
import { createWorldEngine } from "./decide.js";
import { createMemoryPorts } from "./memory-ports.js";
import type { ActorSnapshot, WorldCandidate } from "./ports.js";

const WORLD = "11111111-1111-4111-8111-111111111111";
const SHARD = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const REQUEST = "44444444-4444-4444-8444-444444444444";
const GROCERY_A = "55555555-5555-4555-8555-555555555555";
const GROCERY_B = "66666666-6666-4666-8666-666666666666";

const actor: ActorSnapshot = {
  actorId: ACTOR,
  worldId: WORLD,
  shardId: SHARD,
  locationId: "77777777-7777-4777-8777-777777777777",
  lon: -73.99,
  lat: 40.74,
  version: 3,
  possessedIds: [],
  restrained: false,
  conscious: true,
};

function intentFrom(text: string, extra: Partial<EngineIntent> = {}): EngineIntent {
  const frame = frameFromUtterance(text);
  expect(frame).not.toBeNull();
  return EngineIntentSchema.parse({
    worldId: WORLD,
    shardId: SHARD,
    actorId: ACTOR,
    requestId: REQUEST,
    primitive: frame!.primitive,
    category: frame!.category,
    selector: frame!.selector,
    travelMode: frame!.travelMode,
    rawText: text,
    ...extra,
  });
}

describe("world engine kernel", () => {
  it("maps grocery paraphrases to travel + food retail + nearest", () => {
    for (const text of [
      "go to the nearest grocery store",
      "walk to the closest bodega",
      "find a supermarket",
    ]) {
      const frame = frameFromUtterance(text);
      expect(frame).toMatchObject({
        primitive: "travel",
        category: "place.retail.food",
        selector: "nearest",
      });
    }
    expect(primitiveForKind("move")).toBe("travel");
    expect(primitiveForKind("consume")).toBe("consume");
    expect(primitiveForKind("dialogue")).toBe("communicate");
  });

  it("walks to a GIS source grocery without clarification", async () => {
    const source: WorldCandidate = {
      sourceKey: "osm:shop:99",
      family: "place.retail.food",
      name: "East 14th Convenience",
      distanceMeters: 180,
      lon: -73.988,
      lat: 40.741,
      known: false,
      playable: false,
    };
    const engine = createWorldEngine(
      createMemoryPorts({ actors: [actor], known: [], sources: [source] }),
    );
    const decision = await engine.decide(intentFrom("go to the nearest grocery store"));
    expect(decision.status).toBe("materialize_from_source");
    expect(decision.requiresClarification).toBe(false);
    expect(decision.operations.map((operation) => operation.type)).toEqual([
      "create_instance",
      "move_entity",
    ]);
    expect(decision.target?.sourceKey).toBe("osm:shop:99");
    expect(inventedSuccess(decision)).toBe(false);
  });

  it("does not invent a grocery when the city source is empty", async () => {
    const engine = createWorldEngine(
      createMemoryPorts({ actors: [actor], known: [], sources: [] }),
    );
    const decision = await engine.decide(intentFrom("go to the nearest grocery store"));
    expect(decision.status).toBe("need_source");
    expect(decision.operations).toEqual([]);
    expect(decision.requiresClarification).toBe(false);
    expect(inventedSuccess(decision)).toBe(false);
  });

  it("clarifies only when two known groceries conflict without nearest", async () => {
    const known: WorldCandidate[] = [
      {
        entityId: GROCERY_A,
        family: "place.retail.food",
        name: "A&B Deli",
        distanceMeters: 80,
        lon: -73.991,
        lat: 40.74,
        known: true,
        playable: true,
      },
      {
        entityId: GROCERY_B,
        family: "place.retail.food",
        name: "Ninth Street Market",
        distanceMeters: 240,
        lon: -73.995,
        lat: 40.742,
        known: true,
        playable: true,
      },
    ];
    const engine = createWorldEngine(createMemoryPorts({ actors: [actor], known, sources: [] }));
    const nearest = await engine.decide(intentFrom("go to the nearest grocery store"));
    expect(nearest.status).toBe("bound");
    expect(nearest.requiresClarification).toBe(false);
    expect(nearest.target?.entityId).toBe(GROCERY_A);
    expect(nearest.operations[0]?.type).toBe("move_entity");

    const ambiguous = await engine.decide(
      intentFrom("go to the grocery store", { selector: "named" }),
    );
    expect(ambiguous.status).toBe("clarify_known_conflict");
    expect(ambiguous.requiresClarification).toBe(true);
    expect(ambiguous.operations).toEqual([]);
    expect(ambiguous.clarificationPrompt).toMatch(/A&B Deli/);
  });

  it("treats drive-to-garage as travel with drive mode", async () => {
    const engine = createWorldEngine(
      createMemoryPorts({
        actors: [actor],
        known: [],
        sources: [
          {
            sourceKey: "osm:shop:garage",
            family: "place.service.garage",
            name: "14th Street Auto",
            distanceMeters: 400,
            known: false,
            playable: false,
          },
        ],
      }),
    );
    const decision = await engine.decide(intentFrom("drive to the garage"));
    expect(decision.intent).toMatchObject({
      primitive: "travel",
      category: "place.service.garage",
      travelMode: "drive",
    });
    expect(decision.status).toBe("materialize_from_source");
    expect(decision.operations.length).toBeGreaterThan(0);
  });

  it("refuses to fire a pistol that is not possessed", async () => {
    const engine = createWorldEngine(
      createMemoryPorts({ actors: [actor], known: [], sources: [] }),
    );
    const decision = await engine.decide(
      intentFrom("shoot the pistol", {
        primitive: "operate",
        category: "item.weapon",
        selector: "equipped",
        explicitEntityIds: [],
      }),
    );
    expect(decision.status).toBe("impossible");
    expect(decision.operations).toEqual([]);
    expect(inventedSuccess(decision)).toBe(false);
  });
});
