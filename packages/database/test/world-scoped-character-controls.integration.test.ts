import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_SHARD_ID,
  DEFAULT_WORLD_ID,
  createDatabase,
  createPersistentWorldStore,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("legacy character controls respect world and shard boundaries", () => {
  const db = createDatabase(databaseUrl!);
  const store = createPersistentWorldStore(db);
  const runId = randomUUID();
  const userId = "multiworld-character-test:" + runId;
  const worldTwo = randomUUID();
  const shardTwo = randomUUID();
  const defaultActor = randomUUID();
  const foreignActor = randomUUID();
  const otherUserActor = randomUUID();

  beforeAll(async () => {
    await execFileAsync("pnpm", ["exec", "tsx", "src/migrate.ts"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    await db.client`
      INSERT INTO game.worlds(world_id,slug,name)
      VALUES (${worldTwo}, ${"character-world-" + runId}, 'Character isolation test')
    `;
    await db.client`
      INSERT INTO game.world_shards(shard_id,world_id,slug,name)
      VALUES (${shardTwo},${worldTwo},'primary','Primary')
    `;
    for (const [id, worldId, shardId, owner, selected] of [
      [defaultActor, DEFAULT_WORLD_ID, DEFAULT_SHARD_ID, userId, true],
      [foreignActor, worldTwo, shardTwo, userId, true],
      [otherUserActor, DEFAULT_WORLD_ID, DEFAULT_SHARD_ID, "other-user:" + runId, true],
    ] as const) {
      const definitionId = "test-char-" + id;
      await db.client`
        INSERT INTO game.entity_definitions(
          definition_id, definition_type, name, concept_summary, lifecycle_status, world_id
        ) VALUES (${definitionId}, 'character', 'World test character', 'World-scoped identity test',
                  'approved', ${worldId})
      `;
      await db.client`
        INSERT INTO game.entity_instances(
          instance_id, definition_id, world_id, shard_id, state
        ) VALUES (${id}, ${definitionId}, ${worldId}, ${shardId}, '{}'::jsonb)
      `;
      await db.client`
        INSERT INTO game.player_characters(
          user_id, character_instance_id, world_id, selected
        ) VALUES (${owner}, ${id}, ${worldId}, ${selected})
      `;
    }
  });

  afterAll(() => db.close());

  it("lists and retrieves only default-world characters with legacy calls", async () => {
    const listed = await store.listCharacters(userId);
    expect(listed.map((character) => character.characterId)).toEqual([defaultActor]);
    expect(await store.getCharacter(userId, defaultActor)).toMatchObject({
      characterId: defaultActor,
    });
    expect(await store.getCharacter(userId, foreignActor)).toBeNull();
    expect(await store.getCharacter(userId, otherUserActor)).toBeNull();
  });

  it("allows explicitly scoped reads without revealing the default world's character", async () => {
    const listed = await store.listCharacters(userId, worldTwo);
    expect(listed.map((character) => character.characterId)).toEqual([foreignActor]);
    expect(await store.getCharacter(userId, foreignActor, worldTwo)).toMatchObject({
      characterId: foreignActor,
    });
    expect(await store.getCharacter(userId, defaultActor, worldTwo)).toBeNull();
  });

  it("fails closed when a default-world session selects a foreign-world character", async () => {
    await expect(store.selectCharacter(userId, foreignActor)).rejects.toMatchObject({
      code: "forbidden",
    });
    const rows = await db.client`
      SELECT character_instance_id, selected
      FROM game.player_characters
      WHERE user_id = ${userId} AND world_id = ${DEFAULT_WORLD_ID}
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].character_instance_id).toBe(defaultActor);
    expect(rows[0].selected).toBe(true);
  });

  it("selects a character only in its explicit world without unselecting another world", async () => {
    const selected = await store.selectCharacter(userId, foreignActor, worldTwo);
    expect(selected.characterId).toBe(foreignActor);
    const rows = await db.client`
      SELECT world_id, character_instance_id, selected
      FROM game.player_characters
      WHERE user_id = ${userId}
    `;
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.selected === true)).toBe(true);
  });

  it("rejects renting a default-world apartment for a character in another world", async () => {
    const before = await db.client`
      SELECT count(*)::int AS count FROM game.residence_occupancies
      WHERE character_instance_id = ${foreignActor}
    `;
    await expect(
      store.rentStarterResidence(userId, foreignActor, "cross-world-rental:" + runId),
    ).rejects.toMatchObject({ code: "forbidden" });
    const after = await db.client`
      SELECT count(*)::int AS count FROM game.residence_occupancies
      WHERE character_instance_id = ${foreignActor}
    `;
    expect(after[0].count).toBe(before[0].count);
  });

  it("does not allow another user to select or rent the default-world character", async () => {
    await expect(store.selectCharacter(userId, otherUserActor)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      store.rentStarterResidence(userId, otherUserActor, "wrong-user:" + runId),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
