import { hostname } from "node:os";
import { createAiJobStore, createDatabase, type AiJob } from "@nocturne/database";

const json = (value: unknown) => JSON.stringify(value);

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

const POLL_INTERVAL_MS = 5_000;
const workerId = `${hostname()}:${process.pid}`;
const database = createDatabase(databaseUrl);
const aiJobs = createAiJobStore(database);
const aiJobApiUrl = (
  process.env.AI_JOB_API_URL ||
  process.env.API_URL ||
  process.env.RAILWAY_SERVICE__NOCTURNE_API_URL ||
  ""
).replace(/\/$/, "");
const aiJobWorkerSecret = process.env.AI_JOB_WORKER_SECRET || "";

try {
  await database.client`SELECT 1`;
  await aiJobs.requeueStale();
} catch {
  console.error(
    JSON.stringify({
      level: "error",
      service: "worker",
      message: "worker_start_failed",
      error: "Database connection or queue recovery failed.",
    }),
  );
  await database.close();
  process.exit(1);
}

console.log(
  JSON.stringify({
    level: "info",
    service: "worker",
    message: "worker_started",
    worker_id: workerId,
    ai_jobs_enabled: Boolean(aiJobApiUrl && aiJobWorkerSecret),
  }),
);

let shuttingDown = false;

async function resolveScheduledJob(row: {
  schedule_id: string;
  intent_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
}) {
  const kind = row.kind || "action";
  const payload = row.payload || {};

  if (kind === "move") {
    const actorId = String(payload.actorId || "");
    const locationId = String(payload.locationId || "");
    if (actorId && locationId) {
      await database.client`
        UPDATE game.entity_instances
        SET location_id = ${locationId}, updated_at = now()
        WHERE instance_id = ${actorId}
      `;
    }
    return;
  }

  if (kind === "jail_release") {
    const actorId = String(payload.actorId || "");
    if (actorId) {
      const rows = await database.client`
        SELECT state FROM game.entity_instances WHERE instance_id = ${actorId}
      `;
      const state = { ...((rows[0]?.state as Record<string, unknown>) || {}) };
      state.status = "active";
      state.heat = Math.max(0, Number(state.heat || 0) - 20);
      await database.client`
        UPDATE game.entity_instances SET state = ${json(state)}, updated_at = now()
        WHERE instance_id = ${actorId}
      `;
    }
    return;
  }

  if (kind === "craft_complete") {
    const requestId = payload.requestId ? String(payload.requestId) : null;
    if (requestId) {
      await database.client`
        UPDATE game.generated_content_requests
        SET validation_status = CASE
          WHEN validation_status = 'crafting' THEN 'ready'
          ELSE validation_status
        END,
        updated_at = now()
        WHERE request_id = ${requestId}
      `;
    }
  }
}

async function runAiJob(job: AiJob): Promise<Record<string, unknown>> {
  if (!aiJobApiUrl || !aiJobWorkerSecret) {
    throw new Error("AI job API configuration is missing.");
  }
  const response = await fetch(`${aiJobApiUrl}/v1/internal/ai-jobs/${job.jobId}/run`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-nocturne-worker-secret": aiJobWorkerSecret,
    },
    body: JSON.stringify({ kind: job.kind, payload: job.payload }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {}
  if (!response.ok) {
    const detail =
      payload && typeof payload === "object"
        ? String((payload as Record<string, unknown>).error || response.status)
        : String(response.status);
    throw new Error(`AI job API failed: ${detail}`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("AI job API returned an invalid result.");
  }
  return payload as Record<string, unknown>;
}

async function tickAiJobs() {
  if (!aiJobApiUrl || !aiJobWorkerSecret) return;
  const claimed = await aiJobs.claim(workerId, 5);
  for (const job of claimed) {
    try {
      const result = await runAiJob(job);
      await aiJobs.complete(workerId, job.jobId, result);
      console.log(
        JSON.stringify({
          level: "info",
          service: "worker",
          message: "ai_job_completed",
          job_id: job.jobId,
          kind: job.kind,
          attempt: job.attempts,
        }),
      );
    } catch (error) {
      const delaySeconds = Math.min(300, 5 * 2 ** Math.max(0, job.attempts - 1));
      const updated = await aiJobs.retryOrFail(
        workerId,
        job.jobId,
        error instanceof Error ? error.name || "ai_job_failed" : "ai_job_failed",
        delaySeconds,
      );
      console.error(
        JSON.stringify({
          level: "error",
          service: "worker",
          message: updated.status === "failed" ? "ai_job_failed" : "ai_job_retry_scheduled",
          job_id: job.jobId,
          kind: job.kind,
          attempt: job.attempts,
          next_delay_seconds: updated.status === "retrying" ? delaySeconds : null,
          error: String(error),
        }),
      );
    }
  }
}

async function tickScheduledJobs() {
  const due = await database.client`
    UPDATE game.scheduled_actions
    SET status = 'resolving'
    WHERE schedule_id IN (
      SELECT schedule_id FROM game.scheduled_actions
      WHERE status = 'pending' AND resolves_at <= now()
      ORDER BY resolves_at
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    )
    RETURNING schedule_id, intent_id, kind, payload
  `;

  for (const row of due) {
    try {
      await resolveScheduledJob({
        schedule_id: String(row.schedule_id),
        intent_id: row.intent_id ? String(row.intent_id) : null,
        kind: String(row.kind || "action"),
        payload: (row.payload as Record<string, unknown>) || {},
      });
      await database.client`
        UPDATE game.scheduled_actions SET status = 'resolved'
        WHERE schedule_id = ${row.schedule_id}
      `;
      console.log(
        JSON.stringify({
          level: "debug",
          service: "worker",
          schedule_id: row.schedule_id,
          kind: row.kind,
          message: "job_resolved",
        }),
      );
    } catch (error) {
      await database.client`
        UPDATE game.scheduled_actions SET status = 'failed'
        WHERE schedule_id = ${row.schedule_id}
      `;
      console.error(
        JSON.stringify({
          level: "error",
          service: "worker",
          schedule_id: row.schedule_id,
          error: String(error),
        }),
      );
    }
  }
}

async function tick() {
  if (shuttingDown) return;
  try {
    await Promise.all([tickAiJobs(), tickScheduledJobs()]);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "worker",
        message: "tick_failed",
        error: String(error),
      }),
    );
  }
}

const poller = setInterval(tick, POLL_INTERVAL_MS);
void tick();

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(poller);
  await database.close();
  console.log(
    JSON.stringify({ level: "info", service: "worker", message: "worker_stopping", signal }),
  );
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
