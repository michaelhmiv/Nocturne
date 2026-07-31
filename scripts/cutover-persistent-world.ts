import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
const worldId = process.env.NOCTURNE_WORLD_ID || "00000000-0000-4000-8000-000000000001";
const operatorUserId = process.env.NOCTURNE_CUTOVER_OPERATOR || "system-cutover";
const backupReference = process.env.NOCTURNE_WORLD_BACKUP_REFERENCE;
const confirmation = process.env.CONFIRM_NOCTURNE_WORLD_CUTOVER;
const mode = process.argv[2] || "prepare";

if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!backupReference) {
  throw new Error(
    "NOCTURNE_WORLD_BACKUP_REFERENCE is required. Create and verify the Railway/PostgreSQL backup before cutover.",
  );
}
if (confirmation !== "RESET_NOCTURNE_PERSISTENT_WORLD_V1") {
  throw new Error(
    "Set CONFIRM_NOCTURNE_WORLD_CUTOVER=RESET_NOCTURNE_PERSISTENT_WORLD_V1 to run cutover commands.",
  );
}
if (!new Set(["prepare", "activate", "rollback"]).has(mode)) {
  throw new Error("Usage: pnpm tsx scripts/cutover-persistent-world.ts prepare|activate|rollback");
}

const sql = postgres(databaseUrl, { prepare: false, max: 1 });
const archiveSchema = `archive_${new Date()
  .toISOString()
  .replace(/[-:.TZ]/g, "")
  .slice(0, 14)}`;

async function prepare() {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('nocturne:persistent-world-cutover'))`;
    const worlds = await tx<{ status: string; name: string }[]>`
      SELECT status, name FROM game.worlds WHERE world_id = ${worldId} FOR UPDATE
    `;
    if (!worlds[0]) throw new Error(`World ${worldId} does not exist.`);

    await tx.unsafe(`CREATE SCHEMA ${archiveSchema}`);
    const tables = await tx<{ table_name: string }[]>`
      SELECT DISTINCT table_name
      FROM information_schema.columns
      WHERE table_schema = 'game' AND column_name = 'world_id'
      ORDER BY table_name
    `;
    for (const { table_name: tableName } of tables) {
      if (!/^[a-z_][a-z0-9_]*$/.test(tableName)) {
        throw new Error(`Unsafe table identifier returned by PostgreSQL: ${tableName}`);
      }
      await tx.unsafe(
        `CREATE TABLE ${archiveSchema}.${tableName} AS SELECT * FROM game.${tableName} WHERE world_id = $1::uuid`,
        [worldId],
      );
    }
    const archiveRows = await tx<{ archive_id: string }[]>`
      INSERT INTO game.world_state_archives (
        world_id, archive_kind, database_reference, metadata, created_by
      ) VALUES (
        ${worldId}, 'pre_cutover', ${backupReference},
        ${JSON.stringify({
          archiveSchema,
          runtimeVersion: "persistent-world-v1",
          priorWorldStatus: worlds[0].status,
          priorWorldName: worlds[0].name,
          tableCount: tables.length,
        })}::jsonb,
        ${operatorUserId}
      )
      RETURNING archive_id
    `;
    await tx`
      INSERT INTO game.runtime_features (
        world_id, feature_key, enabled, configuration, updated_by, updated_at
      ) VALUES (
        ${worldId}, 'persistent_world_runtime', false,
        ${JSON.stringify({
          runtimeVersion: "persistent-world-v1",
          legacyMutationRoutesEnabled: true,
          severeOfflinePvpEnabled: false,
          irreversiblePvpEnabled: false,
          preparedArchiveSchema: archiveSchema,
          preparedArchiveId: archiveRows[0]?.archive_id,
          backupReference,
        })}::jsonb,
        ${operatorUserId}, now()
      )
      ON CONFLICT (world_id, feature_key) DO UPDATE
      SET enabled = false,
          configuration = EXCLUDED.configuration,
          updated_by = EXCLUDED.updated_by,
          updated_at = now()
    `;
  });
  console.log(
    JSON.stringify({
      status: "prepared",
      worldId,
      archiveSchema,
      backupReference,
      next: "Run GitHub CI and production smoke tests, then execute activate.",
    }),
  );
}

async function activate() {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('nocturne:persistent-world-cutover'))`;
    const features = await tx<{ configuration: Record<string, unknown> }[]>`
      SELECT configuration
      FROM game.runtime_features
      WHERE world_id = ${worldId}
        AND feature_key = 'persistent_world_runtime'
      FOR UPDATE
    `;
    const configuration = features[0]?.configuration || {};
    if (!configuration.preparedArchiveSchema || !configuration.backupReference) {
      throw new Error("Persistent-world cutover was not prepared with a verified archive.");
    }
    await tx`
      UPDATE game.runtime_features
      SET enabled = true,
          configuration = configuration || ${JSON.stringify({
            runtimeVersion: "persistent-world-v1",
            legacyMutationRoutesEnabled: false,
            severeOfflinePvpEnabled: false,
            irreversiblePvpEnabled: false,
            activatedAt: new Date().toISOString(),
          })}::jsonb,
          updated_by = ${operatorUserId},
          updated_at = now()
      WHERE world_id = ${worldId}
        AND feature_key = 'persistent_world_runtime'
    `;
  });
  console.log(
    JSON.stringify({ status: "activated", worldId, runtimeVersion: "persistent-world-v1" }),
  );
}

async function rollback() {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('nocturne:persistent-world-cutover'))`;
    await tx`
      UPDATE game.runtime_features
      SET enabled = false,
          configuration = configuration || ${JSON.stringify({
            legacyMutationRoutesEnabled: true,
            rollbackRequestedAt: new Date().toISOString(),
          })}::jsonb,
          updated_by = ${operatorUserId},
          updated_at = now()
      WHERE world_id = ${worldId}
        AND feature_key = 'persistent_world_runtime'
    `;
  });
  console.log(
    JSON.stringify({
      status: "runtime_disabled",
      worldId,
      note: "The verified database backup/archive remains authoritative for any full data restore.",
    }),
  );
}

try {
  if (mode === "prepare") await prepare();
  else if (mode === "activate") await activate();
  else await rollback();
} finally {
  await sql.end();
}
