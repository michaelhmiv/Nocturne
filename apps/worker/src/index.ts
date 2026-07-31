import { hostname } from "node:os";
import {
  createAiJobStore,
  createDatabase,
  createScheduledWorkStore,
  type AiJob,
} from "@nocturne/database";
import { readAiJobWorkerConfig } from "./ai-job-config.js";
import { aiJobErrorCode, aiJobIsRetryable, aiJobRetryDelaySeconds } from "./ai-job-policy.js";
import { createScheduledWorkRunner } from "./scheduled-work-runner.js";

const json = (value: unknown) => JSON.stringify(value);
type WorkerApiError = Error & { code?: string; retryable?: boolean; status?: number };

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

const aiJobConfig = (() => {
  try {
    return readAiJobWorkerConfig(process.env);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        service: "worker",
        message: "worker_start_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exit(1);
  }
})();

const POLL_INTERVAL_MS = 5_000;
const workerHost = hostname();
const workerId = `${workerHost}:${process.pid}`;
const database = createDatabase(databaseUrl);
const aiJobs = createAiJobStore(database);
const scheduledWork = createScheduledWorkStore(database);
const aiJobApiUrl = aiJobConfig.apiUrl;
const aiJobWorkerSecret = aiJobConfig.workerSecret;
const scheduledRunner = createScheduledWorkRunner({
  store: scheduledWork,
  apiUrl: aiJobApiUrl,
  workerSecret: aiJobWorkerSecret,
  workerId,
  log: (record) => console.log(JSON.stringify(record)),
  error: (record) => console.error(JSON.stringify(record)),
});

async function recordHeartbeat() {
  const metadata = json({ host: workerHost, pid: process.pid, apiUrl: aiJobApiUrl });
  await database.client`
    INSERT INTO system.worker_heartbeats (
      worker_id,
      role,
      started_at,
      last_seen_at,
      metadata
    )
    VALUES (
      ${workerId},
      'ai_job_worker',
      now(),
      now(),
      ${metadata}::jsonb
    )
    ON CONFLICT (worker_id) DO UPDATE
    SET last_seen_at = now(), metadata = EXCLUDED.metadata
  `;
}

try {
  await database.client`SELECT 1`;
  await recordHeartbeat();
  await aiJobs.requeueStale();
} catch (error) {
  console.error(
    JSON.stringify({
      level: "error",
      service: "worker",
      message: "worker_start_failed",
      error:
        error instanceof Error
          ? error.message
          : "Database connection, migration, or queue recovery failed.",
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
    ai_jobs_enabled: true,
    scheduled_work_enabled: true,
    ai_job_api_url: aiJobApiUrl,
  }),
);

let shuttingDown = false;

async function runAiJob(job: AiJob): Promise<Record<string, unknown>> {
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
    const record =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
    const detail = String(record?.message || record?.error || response.status);
    const failure = new Error(`AI job API failed: ${detail}`) as WorkerApiError;
    failure.code = String(record?.error || `http_${response.status}`);
    if (typeof record?.retryable === "boolean") failure.retryable = record.retryable;
    failure.status = response.status;
    throw failure;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("AI job API returned an invalid result.");
  }
  return payload as Record<string, unknown>;
}

async function tickAiJobs() {
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
      const delaySeconds = aiJobRetryDelaySeconds(job.attempts);
      const errorCode = aiJobErrorCode(error);
      const retryable = aiJobIsRetryable(error);
      const updated = await aiJobs.retryOrFail(
        workerId,
        job.jobId,
        errorCode,
        delaySeconds,
        retryable,
      );
      console.error(
        JSON.stringify({
          level: "error",
          service: "worker",
          message: updated.status === "failed" ? "ai_job_failed" : "ai_job_retry_scheduled",
          job_id: job.jobId,
          kind: job.kind,
          attempt: job.attempts,
          retryable,
          next_delay_seconds: updated.status === "retrying" ? delaySeconds : null,
          error_code: errorCode,
          error: String(error),
        }),
      );
    }
  }
}

async function tick() {
  if (shuttingDown) return;
  try {
    await recordHeartbeat();
    await Promise.all([tickAiJobs(), scheduledRunner.tick()]);
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
