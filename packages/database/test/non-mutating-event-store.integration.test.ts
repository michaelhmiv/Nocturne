import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_SHARD_ID,
  DEFAULT_WORLD_ID,
  NonMutatingEventError,
  createDatabase,
  createNonMutatingEventStore,
  type WorldScope,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

const worldTwoId = "00000000-0000-4000-8000-000000000101";
const shardTwoId = "00000000-0000-4000-8000-000000000102";
const actorOneId = "00000000-0000-4000-8000-000000000201";
const actorTwoId = "00000000-0000-4000-8000-000000000202";

describePostgres("non-mutating event store concurrency (PostgreSQL)", () => {
  const database = createDatabase(databaseUrl!);
  const store = createNonMutatingEventStore(database);

  const scopeOne: WorldScope = {
    worldId: DEFAULT_WORLD_ID,
    shardId: DEFAULT_SHARD_ID,
    userId: "non-mutating-one",
    role: "player",
    selectedCharacterId: actorOneId,
  };
  const scopeTwo: WorldScope = {
    worldId: worldTwoId,
    shardId: shardTwoId,
    userId: "non-mutating-two",
    role: "player",
    selectedCharacterId: actorTwoId,
  };

  beforeAll(async () => {
    await execFileAsync("pnpm", ["exec", "tsx", "src/migrate.ts"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });

    await database.client`
      INSERT INTO game.worlds (world_id, slug, name, status, clock_mode)
      VALUES (${worldTwoId}, 'non-mutating-test-world', 'Non-mutating Test World', 'active', 'realtime')
      ON CONFLICT (world_id) DO NOTHING
    `;
    await database.client`
      INSERT INTO game.world_shards (shard_id, world_id, slug, name, status)
      VALUES (${shardTwoId}, ${worldTwoId}, 'primary', 'Primary', 'active')
      ON CONFLICT (shard_id) DO NOTHING
    `;
    await database.client`
      INSERT INTO game.entity_definitions (
        definition_id, definition_type, name, concept_summary, lifecycle_status, world_id
      ) VALUES
        ('non_mutating_test_character_one', 'character', 'Test Character One', 'Concurrency test actor', 'approved', ${DEFAULT_WORLD_ID}),
        ('non_mutating_test_character_two', 'character', 'Test Character Two', 'Concurrency test actor', 'approved', ${worldTwoId})
      ON CONFLICT (definition_id) DO NOTHING
    `;
    await database.client`
      INSERT INTO game.entity_instances (
        instance_id, definition_id, world_id, shard_id, state
      ) VALUES
        (${actorOneId}, 'non_mutating_test_character_one', ${DEFAULT_WORLD_ID}, ${DEFAULT_SHARD_ID}, '{}'),
        (${actorTwoId}, 'non_mutating_test_character_two', ${worldTwoId}, ${shardTwoId}, '{}')
      ON CONFLICT (instance_id) DO NOTHING
    `;
  });

  afterAll(() => database.close());

  function input(scope: WorldScope, actorId: string, key: string, marker = "same") {
    return {
      scope,
      actorId,
      idempotencyKey: key,
      eventType: "action_completed_non_mutating" as const,
      payload: { marker },
      playerVisibleFacts: ["Routine action completed."],
      hiddenFacts: [],
    };
  }

  it("serializes concurrent first use into one commit and one replay", async () => {
    const request = input(scopeOne, actorOneId, "parallel-first-use");

    const results = await Promise.all([store.record(request), store.record(request)]);

    expect(new Set(results.map((result) => result.eventId)).size).toBe(1);
    expect(new Set(results.map((result) => result.receiptId)).size).toBe(1);
    expect(results.map((result) => result.idempotentReplay).sort()).toEqual([false, true]);

    const receipts = await database.client<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM game.mutation_receipts
      WHERE world_id = ${scopeOne.worldId}
        AND idempotency_key = 'parallel-first-use'
    `;
    expect(receipts[0]?.count).toBe(1);
  });

  it("turns concurrent conflicting payloads into a deterministic idempotency conflict", async () => {
    const results = await Promise.allSettled([
      store.record(input(scopeOne, actorOneId, "parallel-conflict", "left")),
      store.record(input(scopeOne, actorOneId, "parallel-conflict", "right")),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toBeInstanceOf(NonMutatingEventError);
    expect(rejected?.reason).toMatchObject({ code: "idempotency_conflict" });
  });

  it("scopes identical idempotency keys independently by world", async () => {
    const [first, second] = await Promise.all([
      store.record(input(scopeOne, actorOneId, "shared-across-worlds")),
      store.record(input(scopeTwo, actorTwoId, "shared-across-worlds")),
    ]);

    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(false);
    expect(first.eventId).not.toBe(second.eventId);
    expect(first.receiptId).not.toBe(second.receiptId);

    const receipts = await database.client<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM game.mutation_receipts
      WHERE idempotency_key = 'shared-across-worlds'
    `;
    expect(receipts[0]?.count).toBe(2);
  });
});
