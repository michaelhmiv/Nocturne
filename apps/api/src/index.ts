import { registerAiJobRoutesFromEnv } from "./ai-job-routes.js";
import { buildApp } from "./app.js";

const app = await buildApp().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      level: "error",
      service: "api",
      message: "api_start_failed",
      error: error instanceof Error ? error.message : "Unknown startup error.",
    }),
  );
  process.exit(1);
});
await registerAiJobRoutesFromEnv(app);

const port = Number(process.env.PORT || 3001);
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "api_stopping");
  await app.close();
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: "0.0.0.0", port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
