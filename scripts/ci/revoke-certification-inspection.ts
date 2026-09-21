// Revoke the capability without deleting the archived, sanitized run evidence.
import postgres from "postgres";

if (process.env.NOCTURNE_CERT_REVOKE !== "1") {
  throw new Error("Explicit NOCTURNE_CERT_REVOKE=1 is required.");
}
const databaseUrl = process.env.DATABASE_URL;
const runId = process.env.NOCTURNE_CERT_RUN_ID;
if (!databaseUrl || !runId || !/^[0-9a-f-]{36}$/i.test(runId)) {
  throw new Error("DATABASE_URL and a certification run UUID are required.");
}
const db = postgres(databaseUrl, { prepare: false, max: 1 });
try {
  const rows = await db.unsafe(
    "UPDATE game.certification_runs SET status='revoked' WHERE run_id=$1 RETURNING world_id,shard_id",
    [runId],
  );
  if (rows.length !== 1) throw new Error("Certification run was not found.");
  await db.unsafe(
    "UPDATE game.certification_inspection_grants SET revoked_at=COALESCE(revoked_at,now()) WHERE run_id=$1",
    [runId],
  );
  console.log(
    JSON.stringify({
      event: "certification_inspection_revoked",
      runId,
      worldId: rows[0].world_id,
      shardId: rows[0].shard_id,
    }),
  );
} finally {
  await db.end();
}
