import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_WORLD_ID,
  WorldInspectorStoreError,
  createDatabase,
  createPersistentPlanStore,
  createUniversalOperationExecutor,
  createWorldInspectorStore,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("read-only certification grants (PostgreSQL)", () => {
  const database = createDatabase(databaseUrl!);
  const inspector = createWorldInspectorStore(
    database,
    createUniversalOperationExecutor(database),
    createPersistentPlanStore(database),
  );
  const runOne = randomUUID();
  const runTwo = randomUUID();
  const worldOne = randomUUID();
  const worldTwo = randomUUID();
  const shardOne = randomUUID();
  const shardTwo = randomUUID();
  const entityOne = randomUUID();
  const entityTwo = randomUUID();
  const tokenOne = "noct_cert_" + randomBytes(48).toString("base64url");
  const tokenTwo = "noct_cert_" + randomBytes(48).toString("base64url");
  const expiredToken = "noct_cert_" + randomBytes(48).toString("base64url");
  const revokedToken = "noct_cert_" + randomBytes(48).toString("base64url");

  beforeAll(async () => {
    await execFileAsync("pnpm", ["exec", "tsx", "src/migrate.ts"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    for (const [worldId, shardId, runId, entityId, index] of [
      [worldOne, shardOne, runOne, entityOne, "one"],
      [worldTwo, shardTwo, runTwo, entityTwo, "two"],
    ]) {
      await database.client.unsafe(
        "INSERT INTO game.worlds(world_id,slug,name,metadata) VALUES ($1,$2,$3,$4::jsonb)",
        [
          worldId,
          "cert-inspect-test-" + worldId,
          "Certification isolated " + index,
          JSON.stringify({ isolatedCertification: true }),
        ],
      );
      await database.client.unsafe(
        "INSERT INTO game.world_shards(shard_id,world_id,slug,name) VALUES ($1,$2,'primary','Primary')",
        [shardId, worldId],
      );
      await database.client.unsafe(
        "INSERT INTO game.certification_runs(run_id,world_id,shard_id,expires_at) VALUES ($1,$2,$3,now()+interval '30 minutes')",
        [runId, worldId, shardId],
      );
      await database.client.unsafe(
        "INSERT INTO game.entity_definitions(definition_id,definition_type,name,concept_summary,lifecycle_status,world_id) VALUES ($1,'item',$2,'Certification-only test object','approved',$3)",
        ["cert-test-" + index + "-" + runId, "Certification marker " + index, worldId],
      );
      await database.client.unsafe(
        "INSERT INTO game.entity_instances(instance_id,definition_id,world_id,shard_id,state) VALUES ($1,$2,$3,$4,'{}'::jsonb)",
        [entityId, "cert-test-" + index + "-" + runId, worldId, shardId],
      );
    }
    for (const [runId, token, expiry, revoked] of [
      [runOne, tokenOne, "30 minutes", false],
      [runTwo, tokenTwo, "30 minutes", false],
      [runOne, expiredToken, "-1 minute", false],
      [runOne, revokedToken, "30 minutes", true],
    ] as const) {
      await database.client.unsafe(
        "INSERT INTO game.certification_inspection_grants(run_id,token_sha256,expires_at,revoked_at) VALUES ($1,$2,now()+$3::interval,CASE WHEN $4::boolean THEN now() ELSE NULL END)",
        [runId, createHash("sha256").update(token).digest("hex"), expiry, revoked],
      );
    }
  });

  afterAll(() => database.close());

  it("allows read-only inspection only of the token's scoped world and shard", async () => {
    const first = await inspector.inspectCertified({ token: tokenOne, entityId: entityOne });
    expect(first).toMatchObject({ entityId: entityOne, worldId: worldOne, shardId: shardOne });
    const second = await inspector.inspectCertified({ token: tokenTwo, entityId: entityTwo });
    expect(second).toMatchObject({ entityId: entityTwo, worldId: worldTwo, shardId: shardTwo });
  });

  it("denies first-run access to second-run entities without revealing their state", async () => {
    await expect(
      inspector.inspectCertified({ token: tokenOne, entityId: entityTwo }),
    ).rejects.toMatchObject({
      code: "entity_not_found",
    });
    await expect(
      inspector.inspectCertified({ token: tokenTwo, entityId: entityOne }),
    ).rejects.toMatchObject({
      code: "entity_not_found",
    });
  });

  it("never permits inspection of a default-world entity through certification", async () => {
    await expect(
      inspector.inspectCertified({
        token: tokenOne,
        entityId: "10000000-0000-4000-8000-000000000005",
      }),
    ).rejects.toMatchObject({ code: "entity_not_found" });
  });

  it("rejects malformed, unknown, expired and revoked tokens", async () => {
    for (const token of [
      "",
      "not-a-certificate",
      "noct_cert_" + "A".repeat(64),
      expiredToken,
      revokedToken,
    ]) {
      await expect(
        inspector.inspectCertified({ token, entityId: entityOne }),
      ).rejects.toMatchObject({
        code: "forbidden",
      });
    }
  });

  it("rejects a run after revocation even if its token has not expired", async () => {
    await database.client.unsafe(
      "UPDATE game.certification_runs SET status = 'revoked' WHERE run_id = $1",
      [runTwo],
    );
    await expect(
      inspector.inspectCertified({ token: tokenTwo, entityId: entityTwo }),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("never turns the inspection token into the operator role or repair authority", async () => {
    const ordinaryScope = {
      worldId: worldOne,
      shardId: shardOne,
      userId: "ordinary-player",
      role: "player" as const,
      selectedCharacterId: null,
    };
    await expect(
      inspector.inspect({ scope: ordinaryScope, entityId: entityOne }),
    ).rejects.toBeInstanceOf(WorldInspectorStoreError);
    await expect(
      inspector.repair({
        scope: ordinaryScope,
        request: { actionType: "toggle_runtime_feature", reason: "not allowed" } as never,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("audits valid, cross-run, expired and revoked attempts without plaintext tokens", async () => {
    const rows = await database.client.unsafe(
      "SELECT granted,reason,world_id,shard_id FROM game.certification_inspection_audit WHERE run_id = $1 ORDER BY created_at",
      [runOne],
    );
    expect(rows.some((entry) => entry.granted === true && entry.reason === "read")).toBe(true);
    expect(rows.some((entry) => entry.reason === "entity_not_found")).toBe(true);
    expect(rows.some((entry) => entry.reason === "expired_or_revoked")).toBe(true);
    expect(rows.every((entry) => entry.world_id === worldOne && entry.shard_id === shardOne)).toBe(
      true,
    );
    const credentialLeak = await database.client.unsafe(
      "SELECT count(*)::int AS count FROM game.certification_inspection_audit WHERE reason LIKE $1",
      ["%" + tokenOne + "%"],
    );
    expect(credentialLeak[0].count).toBe(0);
    expect(worldOne).not.toBe(DEFAULT_WORLD_ID);
  });
});
