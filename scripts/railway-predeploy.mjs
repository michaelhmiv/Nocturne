import { spawnSync } from "node:child_process";

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL is not configured for this service; skipping database migrations.");
  process.exit(0);
}

const result = spawnSync("pnpm", ["db:migrate"], {
  stdio: "inherit",
  env: process.env,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
