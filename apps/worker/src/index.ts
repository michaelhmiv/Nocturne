import { createDatabase } from "@nocturne/database";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(
    JSON.stringify({
      level: "error",
      service: "worker",
      message: "worker_start_failed",
      error: "DATABASE_URL is required.",
    }),
  );
  process.exit(1);
}

const database = createDatabase(databaseUrl);
try {
  await database.client`SELECT 1`;
} catch {
  console.error(
    JSON.stringify({
      level: "error",
      service: "worker",
      message: "worker_start_failed",
      error: "Database connection failed.",
    }),
  );
  await database.close();
  process.exit(1);
}

console.log(JSON.stringify({ level: "info", service: "worker", message: "worker_started" }));

const heartbeat = setInterval(() => {
  console.log(JSON.stringify({ level: "debug", service: "worker", message: "worker_heartbeat" }));
}, 30_000);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeat);
  await database.close();
  console.log(
    JSON.stringify({ level: "info", service: "worker", message: "worker_stopping", signal }),
  );
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
