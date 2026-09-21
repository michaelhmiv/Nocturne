import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_WORLD_ID,
  PersistentWorldError,
  WorldScopeError,
  createDatabase,
  createPersistentWorldStore,
  createWorldStore,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("server-bound certification player isolation", () => {
  const db = createDatabase(databaseUrl!);
  const worlds = createWorldStore(db);
  const legacy = createPersistentWorldStore(db);
  const runId = randomUUID();
  const worldId = randomUUID();
  const shardId = randomUUID();
  const account = "cert-world-account:" + runId;
  const ordinaryAccount = "ordinary-world-account:" + runId;

  beforeAll(async () => {
    await execFileAsync("pnpm", ["exec", "tsx", "src/migrate.ts"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    await db.client`
      INSERT INTO game.worlds(world_id,slug,name,metadata)
      VALUES (${worldId}, ${"cert-world-" + runId}, 'Isolated certification world',
        '{"isolatedCertification":true}'::jsonb)
    `;
    await db.client`
      INSERT INTO game.world_shards(shard_id,world_id,slug,name)
      VALUES (${shardId},${worldId},'primary','Primary')
    `;
    await db.client`
      INSERT INTO game.certification_runs(run_id,world_id,shard_id,expires_at)
      VALUES (${runId},${worldId},${shardId},now()+interval '30 minutes')
    `;
    await db.client`
      INSERT INTO game.certification_players(run_id,user_id,world_id,shard_id)
      VALUES (${runId},${account},${worldId},${shardId})
    `;
    await db.client`
      INSERT INTO game.world_memberships(world_id,user_id,role,status)
      VALUES (${worldId},${account},'player','active')
    `;
  });

  afterAll(() => db.close());

  it("routes by authenticated user ID rather than public-world defaults", async () => {
    const scope = await worlds.resolveForAuthenticatedUser(account);
    expect(scope).toMatchObject({
      worldId, shardId, userId: account, role: "player", selectedCharacterId: null,
    });
    expect(await worlds.isCertificationBoundUser(account)).toBe(true);
    const unintended = await db.client`
      SELECT 1 FROM game.world_memberships
      WHERE world_id = ${DEFAULT_WORLD_ID} AND user_id = ${account}
    `;
    expect(unintended).toHaveLength(0);
  });

  it("routes unbound ordinary players to the public world as before", async () => {
    const scope = await worlds.resolveForAuthenticatedUser(ordinaryAccount);
    expect(scope).toMatchObject({
      worldId: DEFAULT_WORLD_ID, userId: ordinaryAccount, role: "player",
    });
    expect(await worlds.isCertificationBoundUser(ordinaryAccount)).toBe(false);
  });

  it("blocks all legacy default-world onboarding for bound certification accounts", async () => {
    await expect(legacy.assertPublicWorldUser(account)).rejects.toBeInstanceOf(
      PersistentWorldError,
    );
    await expect(legacy.listCharacters(account)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(legacy.createCharacter(
      account,
      {
        name: "Should Never Exist",
        conceptSummary: "Cross-world onboarding must be rejected.",
        originSource: "ci",
        qualities: {},
      } as never,
      "blocked-character:" + runId,
    )).rejects.toMatchObject({ code: "forbidden" });
    await expect(legacy.rentStarterResidence(
      account, randomUUID(), "blocked-rent:" + runId,
    )).rejects.toMatchObject({ code: "forbidden" });
    const rows = await db.client`
      SELECT 1 FROM game.player_characters WHERE user_id = ${account}
    `;
    expect(rows).toHaveLength(0);
  });

  it("does not accept a run/world mismatch in persisted player grants", async () => {
    await expect(
      db.client`
        INSERT INTO game.certification_players(run_id,user_id,world_id,shard_id)
        VALUES (${runId},${"fake-mismatch:" + runId},${DEFAULT_WORLD_ID},${shardId})
      `,
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rejects elevated certification player roles instead of using operator access", async () => {
    await db.client`
      UPDATE game.world_memberships SET role = 'operator'
      WHERE world_id = ${worldId} AND user_id = ${account}
    `;
    await expect(worlds.resolveForAuthenticatedUser(account)).rejects.toBeInstanceOf(
      WorldScopeError,
    );
    await db.client`
      UPDATE game.world_memberships SET role = 'player'
      WHERE world_id = ${worldId} AND user_id = ${account}
    `;
  });

  it("rejects revoked runs without falling back into the public world", async () => {
    await db.client`
      UPDATE game.certification_runs SET status = 'revoked'
      WHERE run_id = ${runId}
    `;
    await expect(worlds.resolveForAuthenticatedUser(account)).rejects.toMatchObject({
      code: "membership_inactive",
    });
    expect(await worlds.isCertificationBoundUser(account)).toBe(true);
    const unintended = await db.client`
      SELECT 1 FROM game.world_memberships
      WHERE world_id = ${DEFAULT_WORLD_ID} AND user_id = ${account}
    `;
    expect(unintended).toHaveLength(0);
    await expect(legacy.listCharacters(account)).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
