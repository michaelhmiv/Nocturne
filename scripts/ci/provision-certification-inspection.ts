// Offline, one-purpose issuance: do not expose this via player HTTP, MCP, or OAuth.
// The new world intentionally has no starter geography until world-scoped
// character/housing provisioning and the full story runner are implemented.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import postgres from "postgres";

if (process.env.NOCTURNE_CERT_PROVISION !== "1") {
  throw new Error("Explicit NOCTURNE_CERT_PROVISION=1 is required.");
}
const databaseUrl = process.env.DATABASE_URL;
const output = process.env.NOCTURNE_CERT_TOKEN_OUTPUT;
if (!databaseUrl || !output || !isAbsolute(output)) {
  throw new Error("DATABASE_URL and an absolute NOCTURNE_CERT_TOKEN_OUTPUT are required.");
}
const minutes = Number(process.env.NOCTURNE_CERT_TTL_MINUTES || "60");
if (!Number.isInteger(minutes) || minutes < 1 || minutes > 90) {
  throw new Error("Certification inspection grants must expire within 1–90 minutes.");
}

const runId = randomUUID();
const worldId = randomUUID();
const shardId = randomUUID();
const token = "noct_cert_" + randomBytes(48).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const expiresAt = new Date(Date.now() + minutes * 60_000);
const db = postgres(databaseUrl, { max: 1, prepare: false });

try {
  await db.begin(async (sql) => {
    await sql.unsafe(
      "INSERT INTO game.worlds(world_id,slug,name,status,metadata) VALUES ($1,$2,$3,'active',$4::jsonb)",
      [worldId, "certification-" + runId, "Isolated certification " + runId,
        JSON.stringify({ isolatedCertification: true, runId, starterProvisioned: false })],
    );
    await sql.unsafe(
      "INSERT INTO game.world_shards(shard_id,world_id,slug,name) VALUES ($1,$2,'primary','Primary')",
      [shardId, worldId],
    );
    await sql.unsafe(
      "INSERT INTO game.certification_runs(run_id,world_id,shard_id,expires_at) VALUES ($1,$2,$3,$4)",
      [runId, worldId, shardId, expiresAt],
    );
    await sql.unsafe(
      "INSERT INTO game.certification_inspection_grants(run_id,token_sha256,expires_at) VALUES ($1,$2,$3)",
      [runId, tokenHash, expiresAt],
    );
  });
  // One-time file, mode 0600. Never put this file in version control, CI
  // artifacts, workflow logs or narration / game events.
  try {
    await writeFile(output, token + "\n", { flag: "wx", mode: 0o600 });
  } catch (error) {
    await db.unsafe(
      "UPDATE game.certification_runs SET status = 'revoked' WHERE run_id = $1",
      [runId],
    );
    throw error;
  }
  console.log(JSON.stringify({
    event: "certification_inspection_provisioned",
    runId, worldId, shardId, expiresAt: expiresAt.toISOString(),
    starterProvisioned: false,
    note: "Read-only inspector only; player character/housing world-scoping is not enabled.",
  }));
} finally {
  await db.end();
}
