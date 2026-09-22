import { describe, expect, it } from "vitest";
import { EngineIntentSchema, inventedSuccess, type EngineIntent } from "@nocturne/contracts";
import { createWorldEngine } from "./decide.js";
import { createMemoryPorts } from "./memory-ports.js";
import type { ActorSnapshot, WorldCandidate } from "./ports.js";

const WORLD = "11111111-1111-4111-8111-111111111111";
const WORLD_B = "99999999-9999-4999-8999-999999999999";
const SHARD = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";
const REQUEST = "44444444-4444-4444-8444-444444444444";
const ITEM = "55555555-5555-4555-8555-555555555555";
const CAR = "66666666-6666-4666-8666-666666666666";
const GUN = "77777777-7777-4777-8777-777777777777";
const CLERK = "88888888-8888-4888-8888-888888888888";
const SUSPECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const actor: ActorSnapshot = {
  actorId: ACTOR,
  worldId: WORLD,
  shardId: SHARD,
  locationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  lon: -73.99,
  lat: 40.735,
  version: 3,
  possessedIds: [GUN],
  restrained: false,
  conscious: true,
};

function intent(partial: Partial<EngineIntent> & Pick<EngineIntent, "primitive" | "rawText">) {
  return EngineIntentSchema.parse({
    worldId: WORLD,
    shardId: SHARD,
    actorId: ACTOR,
    requestId: REQUEST,
    selector: "nearest",
    ...partial,
  });
}

describe("build-out 2 starter loop", () => {
  it("perceives without mutating", async () => {
    const engine = createWorldEngine(
      createMemoryPorts({ actors: [actor], known: [], sources: [] }),
    );
    const decision = await engine.decide(
      intent({ primitive: "perceive", category: "body.self", rawText: "look at myself" }),
    );
    expect(decision.status).toBe("bound");
    expect(decision.operations).toEqual([]);
    expect(inventedSuccess(decision)).toBe(false);
  });

  it("buys by transferring a present item", async () => {
    const stock: WorldCandidate = {
      entityId: ITEM,
      family: "item.consumable",
      name: "sandwich",
      distanceMeters: 1,
      known: true,
      playable: true,
    };
    const engine = createWorldEngine(
      createMemoryPorts({ actors: [actor], known: [stock], sources: [] }),
    );
    const decision = await engine.decide(
      intent({
        primitive: "transfer",
        category: "item.consumable",
        explicitEntityIds: [ITEM],
        rawText: "buy the sandwich",
      }),
    );
    expect(decision.operations[0]).toMatchObject({
      type: "transfer_possession",
      entityRef: { entityId: ITEM },
    });
  });

  it("eats from a possessed item", async () => {
    const engine = createWorldEngine(
      createMemoryPorts({ actors: [actor], known: [], sources: [] }),
    );
    const decision = await engine.decide(
      intent({
        primitive: "consume",
        category: "item.consumable",
        explicitEntityIds: [GUN],
        rawText: "eat the sandwich",
      }),
    );
    expect(decision.operations[0]).toMatchObject({
      type: "adjust_resource",
      resource: "nutrition",
    });
  });

  it("talks to a clerk without transferring stock", async () => {
    const clerk: WorldCandidate = {
      entityId: CLERK,
      family: "actor.clerk",
      name: "night clerk",
      distanceMeters: 2,
      known: true,
      playable: true,
    };
    const engine = createWorldEngine(
      createMemoryPorts({ actors: [actor], known: [clerk], sources: [] }),
    );
    const decision = await engine.decide(
      intent({
        primitive: "communicate",
        category: "actor.clerk",
        explicitEntityIds: [CLERK],
        rawText: "talk to the clerk",
      }),
    );
    expect(decision.operations[0]?.type).toBe("create_information_asset");
    expect(decision.operations.some((op) => op.type === "transfer_possession")).toBe(false);
  });

  it("waits on the wall clock", async () => {
    const engine = createWorldEngine(
      createMemoryPorts({ actors: [actor], known: [], sources: [] }),
    );
    const decision = await engine.decide(
      intent({
        primitive: "wait",
        rawText: "wait two minutes",
        constraints: { durationSeconds: 120 },
      }),
    );
    expect(decision.operations[0]).toMatchObject({
      type: "schedule_timed_work",
      durationSeconds: 120,
    });
  });
});

describe("build-out 3A vehicle", () => {
  it("occupies a present car", async () => {
    const car: WorldCandidate = {
      entityId: CAR,
      family: "vehicle.automobile",
      name: "parked civic",
      distanceMeters: 4,
      known: true,
      playable: true,
    };
    const engine = createWorldEngine(
      createMemoryPorts({ actors: [actor], known: [car], sources: [] }),
    );
    const decision = await engine.decide(
      intent({
        primitive: "occupy",
        category: "vehicle.automobile",
        explicitEntityIds: [CAR],
        rawText: "get in the parked car",
      }),
    );
    expect(decision.operations[0]).toMatchObject({ relationType: "seated_in" });
  });

  it("burns fuel when operating a bound car", async () => {
    const car: WorldCandidate = {
      entityId: CAR,
      family: "vehicle.automobile",
      name: "parked civic",
      distanceMeters: 4,
      known: true,
      playable: true,
    };
    const engine = createWorldEngine(
      createMemoryPorts({ actors: [actor], known: [car], sources: [] }),
    );
    const decision = await engine.decide(
      intent({
        primitive: "operate",
        category: "vehicle.automobile",
        explicitEntityIds: [CAR],
        rawText: "start the car",
      }),
    );
    expect(decision.operations[0]).toMatchObject({ resource: "fuel", delta: -1 });
  });
});

describe("build-out 3B weapons", () => {
  it("refuses a pistol the actor does not hold", async () => {
    const empty = { ...actor, possessedIds: [] };
    const engine = createWorldEngine(
      createMemoryPorts({ actors: [empty], known: [], sources: [] }),
    );
    const missing = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const decision = await engine.decide(
      intent({
        primitive: "operate",
        category: "item.weapon",
        explicitEntityIds: [missing],
        rawText: "shoot the pistol",
      }),
    );
    expect(decision.status).toBe("impossible");
    expect(decision.operations).toEqual([]);
    expect(inventedSuccess(decision)).toBe(false);
  });

  it("fires a possessed weapon by spending ammo", async () => {
    const engine = createWorldEngine(
      createMemoryPorts({ actors: [actor], known: [], sources: [] }),
    );
    const decision = await engine.decide(
      intent({
        primitive: "operate",
        category: "item.weapon",
        explicitEntityIds: [GUN],
        rawText: "shoot the pistol",
      }),
    );
    expect(decision.status).toBe("bound");
    expect(decision.operations[0]).toMatchObject({ resource: "ammunition", delta: -1 });
  });
});

describe("build-out 3C heat", () => {
  it("restrains a known suspect without inventing police", async () => {
    const suspect: WorldCandidate = {
      entityId: SUSPECT,
      family: "actor.civilian",
      name: "suspect",
      distanceMeters: 3,
      known: true,
      playable: true,
    };
    const engine = createWorldEngine(
      createMemoryPorts({ actors: [actor], known: [suspect], sources: [] }),
    );
    const decision = await engine.decide(
      intent({
        primitive: "restrain",
        category: "actor.civilian",
        explicitEntityIds: [SUSPECT],
        rawText: "arrest them",
      }),
    );
    expect(decision.operations[0]).toMatchObject({ relationType: "detained_by" });
  });
});

describe("build-out 4 isolation", () => {
  it("does not let world B bind world A's clerk", async () => {
    const clerk: WorldCandidate = {
      entityId: CLERK,
      worldId: WORLD,
      shardId: SHARD,
      family: "actor.clerk",
      name: "night clerk",
      distanceMeters: 2,
      known: true,
      playable: true,
    };
    const foreign: ActorSnapshot = { ...actor, worldId: WORLD_B };
    const engine = createWorldEngine(
      createMemoryPorts({ actors: [foreign], known: [clerk], sources: [] }),
    );
    const decision = await engine.decide(
      EngineIntentSchema.parse({
        worldId: WORLD_B,
        shardId: SHARD,
        actorId: ACTOR,
        requestId: REQUEST,
        primitive: "communicate",
        category: "actor.clerk",
        rawText: "talk to the clerk",
      }),
    );
    expect(decision.status).toBe("need_source");
    expect(decision.operations).toEqual([]);
  });
});
