import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required.");
}

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
const client = postgres(connectionString, { prepare: false, max: 1 });
const migrationLockKey = 1_313_819_667;

try {
  // API, worker, and web services can enter pre-deploy concurrently on Railway.
  // A session-level advisory lock makes the migration runner safe in that case.
  await client.unsafe(`SELECT pg_advisory_lock(${migrationLockKey})`);

  try {
    await client.unsafe(`
      CREATE SCHEMA IF NOT EXISTS system;
      CREATE TABLE IF NOT EXISTS system.schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    const files = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    const applied = await client<{ name: string; checksum: string }[]>`
      SELECT name, checksum FROM system.schema_migrations
    `;
    const appliedByName = new Map(applied.map((migration) => [migration.name, migration.checksum]));

    for (const file of files) {
      const sql = await readFile(join(migrationsDirectory, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existingChecksum = appliedByName.get(file);

      if (existingChecksum && existingChecksum !== checksum) {
        throw new Error(`Applied migration ${file} has been modified.`);
      }
      if (existingChecksum) continue;

      await client.begin(async (transaction) => {
        await transaction.unsafe(sql);
        await transaction`
          INSERT INTO system.schema_migrations (name, checksum)
          VALUES (${file}, ${checksum})
        `;
      });

      console.log(`Applied ${file}`);
    }
  } finally {
    await client.unsafe(`SELECT pg_advisory_unlock(${migrationLockKey})`);
  }
} finally {
  await client.end();
}
