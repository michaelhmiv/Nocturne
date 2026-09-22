import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
assert.ok(url, "DATABASE_URL must be configured; no fallback is permitted");
const parsed = new URL(url);
assert.ok(["postgres:", "postgresql:"].includes(parsed.protocol), "Expected PostgreSQL URL");
assert.ok(parsed.hostname && parsed.port, "Expected public TCP proxy hostname and port");
assert.ok(!/^(localhost|127\.0\.0\.1)$/.test(parsed.hostname), "Expected remote Testing database");
assert.ok(!parsed.hostname.endsWith(".railway.internal"), "A private Railway hostname cannot be used in GitHub Actions");
const connection = postgres(url, { max: 1, connect_timeout: 15, ssl: "require" });
try {
  const rows = await connection.begin("read only", (tx) => tx.unsafe(
    "SELECT current_setting('server_version_num')::int AS version, " +
    "current_setting('transaction_read_only') = 'on' AS read_only, " +
    "to_regclass('game.worlds') IS NOT NULL AS has_worlds, " +
    "to_regclass('system.schema_migrations') IS NOT NULL AS has_migrations"
  ));
  const row = rows[0];
  assert.equal(row.read_only, true, "Probe must execute in a read-only transaction");
  const fingerprint = createHash("sha256").update(parsed.hostname + ":" + parsed.port).digest("hex").slice(0, 16);
  console.log(JSON.stringify({
    event: "testing_database_readonly_probe",
    connected: true,
    endpointFingerprint: fingerprint,
    postgresMajor: Math.floor(row.version / 10000),
    hasWorlds: row.has_worlds,
    hasMigrations: row.has_migrations,
    identity: "NOT_YET_INDEPENDENTLY_VERIFIED",
  }));
} finally {
  await connection.end({ timeout: 5 });
}
