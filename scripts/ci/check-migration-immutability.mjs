import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const baseRef = process.env.MIGRATION_BASE_REF || "origin/main";
const directory = "packages/database/migrations";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

try {
  git("rev-parse", "--verify", baseRef);
} catch {
  throw new Error(
    `Migration base ref ${baseRef} is unavailable. Checkout must use fetch-depth: 0.`,
  );
}

const currentFiles = new Set((await readdir(directory)).filter((file) => file.endsWith(".sql")));
const baseFiles = git("ls-tree", "-r", "--name-only", baseRef, directory)
  .split(/\r?\n/)
  .filter((path) => path.endsWith(".sql"));

const changed = [];
const removed = [];
for (const path of baseFiles) {
  const file = path.slice(directory.length + 1);
  if (!currentFiles.has(file)) {
    removed.push(path);
    continue;
  }
  const base = git("show", `${baseRef}:${path}`);
  const current = await readFile(join(directory, file), "utf8");
  const baseHash = createHash("sha256").update(base).digest("hex");
  const currentHash = createHash("sha256").update(current).digest("hex");
  if (baseHash !== currentHash) changed.push({ path, baseHash, currentHash });
}

if (changed.length || removed.length) {
  throw new Error(
    `Applied migration history is immutable. ${JSON.stringify({ changed, removed }, null, 2)}`,
  );
}

console.log(
  JSON.stringify(
    {
      status: "passed",
      baseRef,
      protectedMigrationCount: baseFiles.length,
      newMigrations: [...currentFiles]
        .filter((file) => !baseFiles.includes(`${directory}/${file}`))
        .sort(),
    },
    null,
    2,
  ),
);
