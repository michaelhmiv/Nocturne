import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations");
const files = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const pattern = /^\d{4}[a-z]?_[a-z0-9_]+\.sql$/;

if (files.length === 0) {
  throw new Error("No SQL migrations were found.");
}

for (const file of files) {
  if (!pattern.test(file)) {
    throw new Error(
      `Migration ${file} does not match ####_name.sql or ####a_corrective_name.sql.`,
    );
  }
  const sql = (await readFile(join(migrationsDirectory, file), "utf8")).trim();
  if (!sql) {
    throw new Error(`Migration ${file} is empty.`);
  }
}

console.log(`Validated ${files.length} migration file(s).`);
