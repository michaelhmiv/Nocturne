import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_WORLD_ID, createDatabase, createWorldStore } from "../src/index.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("isolated, physically playable certification district", () => {
  const db = createDatabase(databaseUrl!);
  const worlds = createWorldStore(db);
  const run = randomUUID();
  const otherRun = randomUUID();
  const world = randomUUID();
  const otherWorld = randomUUID();
  const shard = randomUUID();
  const otherShard = randomUUID();
  const players = ["mara", "dax", "imani"].map((alias) => ({
    alias,
    userId: "certification-physical:" + run + ":" + alias,
  }));
  const otherUser = "certification-physical:" + otherRun + ":mara";
  let district: Record<string, string>;
  let actorRows: { actor_id: string; residence_id: string; already_provisioned: boolean }[] = [];

  beforeAll(async () => {
    await execFileAsync("pnpm", ["exec", "tsx", "src/migrate.ts"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    for (const [runId, worldId, shardId] of [
      [run, world, shard],
      [otherRun, otherWorld, otherShard],
    ]) {
      await db.client.unsafe(
        "INSERT INTO game.worlds(world_id,slug,name,metadata) VALUES ($1,$2,'Isolated story fixture',$3::jsonb)",
        [worldId, "fixture-" + runId, JSON.stringify({ isolatedCertification: true })],
      );
      await db.client.unsafe(
        "INSERT INTO game.world_shards(shard_id,world_id,slug,name) VALUES ($1,$2,'primary','Primary')",
        [shardId, worldId],
      );
      await db.client.unsafe(
        "INSERT INTO game.certification_runs(run_id,world_id,shard_id,expires_at) VALUES ($1,$2,$3,now()+interval '30 minutes')",
        [runId, worldId, shardId],
      );
    }
    for (const [runId, worldId, shardId, userId] of [
      ...players.map((p) => [run, world, shard, p.userId]),
      [otherRun, otherWorld, otherShard, otherUser],
    ]) {
      await db.client.unsafe(
        "INSERT INTO game.certification_players(run_id,user_id,world_id,shard_id) VALUES ($1,$2,$3,$4)",
        [runId, userId, worldId, shardId],
      );
      await db.client.unsafe(
        "INSERT INTO game.world_memberships(world_id,user_id,role,status) VALUES ($1,$2,'player','active')",
        [worldId, userId],
      );
    }
  });

  afterAll(() => db.close());

  it("seeds one repeatable 5-place district, wholly outside public geography", async () => {
    const first = await db.client.unsafe(
      "SELECT game.provision_certification_district($1) AS district",
      [run],
    );
    district = first[0].district as Record<string, string>;
    expect(district).toMatchObject({ runId: run, worldId: world, shardId: shard });
    expect(
      new Set([
        district.cityId,
        district.districtId,
        district.neighborhoodId,
        district.buildingId,
        district.alleyId,
      ]).size,
    ).toBe(5);
    const second = await db.client.unsafe(
      "SELECT game.provision_certification_district($1) AS district",
      [run],
    );
    expect(second[0].district).toEqual(district);
    const locations = await db.client.unsafe(
      "SELECT instance_id,world_id,shard_id FROM game.entity_instances WHERE world_id=$1 AND shard_id=$2",
      [world, shard],
    );
    expect(locations).toHaveLength(5);
    expect(locations.every((l) => l.world_id === world && l.shard_id === shard)).toBe(true);
    const traversable = await db.client.unsafe(
      "SELECT parameters FROM game.entity_relations WHERE world_id=$1 AND source_instance_id=$2 AND target_instance_id=$3 AND relation_type='adjacent_to'",
      [world, district.buildingId, district.alleyId],
    );
    expect(traversable).toHaveLength(1);
    expect(traversable[0].parameters).toMatchObject({ bidirectional: true });
  });

  it("creates three separate real characters, apartments, ownership and logged events", async () => {
    for (const player of players) {
      const name = { mara: "Mara Velez", dax: "Dax Mercer", imani: "Imani Brooks" }[
        player.alias as "mara" | "dax" | "imani"
      ];
      const rows = await db.client.unsafe(
        "SELECT * FROM game.provision_certification_player($1,$2,$3)",
        [run, player.userId, name],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].already_provisioned).toBe(false);
      actorRows.push(rows[0] as (typeof actorRows)[number]);
      const resolved = await worlds.resolveForAuthenticatedUser(player.userId);
      expect(resolved).toMatchObject({
        worldId: world,
        shardId: shard,
        role: "player",
        selectedCharacterId: rows[0].actor_id,
      });
    }
    expect(new Set(actorRows.map((a) => a.actor_id)).size).toBe(3);
    expect(new Set(actorRows.map((a) => a.residence_id)).size).toBe(3);
    const occupancy = await db.client.unsafe(
      "SELECT residence_instance_id,character_instance_id,world_id FROM game.residence_occupancies WHERE world_id=$1",
      [world],
    );
    expect(occupancy).toHaveLength(3);
    expect(occupancy.every((o) => o.world_id === world)).toBe(true);
    const units = await db.client.unsafe(
      "SELECT instance_id,world_id,shard_id,location_id,state->>'unitLabel' AS label FROM game.entity_instances WHERE world_id=$1 AND state->>'housingType'='starter_apartment'",
      [world],
    );
    expect(units).toHaveLength(3);
    expect(
      units.every(
        (u) =>
          u.world_id === world && u.shard_id === shard && u.location_id === district.buildingId,
      ),
    ).toBe(true);
    expect(new Set(units.map((u) => u.label)).size).toBe(3);
    const routes = await db.client.unsafe(
      "SELECT source_instance_id FROM game.entity_relations WHERE world_id=$1 AND target_instance_id=$2 AND relation_type='accessible_via'",
      [world, district.buildingId],
    );
    expect(routes).toHaveLength(3);
    const events = await db.client.unsafe(
      "SELECT event_type,world_id,shard_id FROM game.event_ledger WHERE world_id=$1 AND event_type IN ('character_created','starter_residence_provisioned')",
      [world],
    );
    expect(events).toHaveLength(6);
    expect(events.every((e) => e.world_id === world && e.shard_id === shard)).toBe(true);
  });

  it("repeated provisioning returns the same actor and residence without duplicate events", async () => {
    const replay = await db.client.unsafe(
      "SELECT * FROM game.provision_certification_player($1,$2,$3)",
      [run, players[0].userId, "Mara Velez"],
    );
    expect(replay[0]).toMatchObject({
      actor_id: actorRows[0].actor_id,
      residence_id: actorRows[0].residence_id,
      already_provisioned: true,
    });
    const events = await db.client.unsafe(
      "SELECT event_id FROM game.event_ledger WHERE world_id=$1 AND event_type IN ('character_created','starter_residence_provisioned')",
      [world],
    );
    expect(events).toHaveLength(6);
  });

  it("never provisions a foreign-bound user or leaks other-run geography", async () => {
    await expect(
      db.client.unsafe("SELECT * FROM game.provision_certification_player($1,$2,$3)", [
        run,
        otherUser,
        "Foreign Account",
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    const second = await db.client.unsafe(
      "SELECT game.provision_certification_district($1) AS district",
      [otherRun],
    );
    const different = second[0].district;
    expect(different.worldId).toBe(otherWorld);
    expect(different.buildingId).not.toBe(district.buildingId);
    const noForeign = await db.client.unsafe(
      "SELECT 1 FROM game.entity_instances WHERE world_id=$1 AND instance_id=$2",
      [otherWorld, district.buildingId],
    );
    expect(noForeign).toHaveLength(0);
    const publicRecords = await db.client.unsafe(
      "SELECT 1 FROM game.player_characters WHERE world_id=$1 AND user_id=$2",
      [DEFAULT_WORLD_ID, players[0].userId],
    );
    expect(publicRecords).toHaveLength(0);
  });

  it("rejects revoked runs without provisioned public-world fallback", async () => {
    await db.client.unsafe("UPDATE game.certification_runs SET status='revoked' WHERE run_id=$1", [
      run,
    ]);
    await expect(
      db.client.unsafe("SELECT * FROM game.provision_certification_player($1,$2,$3)", [
        run,
        players[0].userId,
        "Mara Velez",
      ]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      db.client.unsafe("SELECT game.provision_certification_district($1)", [run]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(worlds.resolveForAuthenticatedUser(players[0].userId)).rejects.toMatchObject({
      code: "membership_inactive",
    });
  });
});
