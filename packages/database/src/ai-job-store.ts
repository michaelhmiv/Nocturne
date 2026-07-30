import { randomUUID } from "node:crypto";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";

export type AiJobKind = "action_resolution" | "invention_normalization";
export type AiJobStatus = "pending" | "processing" | "retrying" | "completed" | "failed";

export type AiJob = {
  jobId: string;
  userId: string;
  kind: AiJobKind;
  idempotencyKey: string;
  requestHash: string;
  payload: Record<string, unknown>;
  status: AiJobStatus;
  attempts: number;
  maxAttempts: number;
  availableAt: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

type AiJobRow = {
  job_id: string;
  user_id: string;
  kind: AiJobKind;
  idempotency_key: string;
  request_hash: string;
  payload: Record<string, unknown>;
  status: AiJobStatus;
  attempts: number;
  max_attempts: number;
  available_at: Date | string;
  locked_at: Date | string | null;
  locked_by: string | null;
  result: Record<string, unknown> | null;
  error_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
};

export class AiJobStoreError extends Error {
  constructor(
    readonly code: "invalid_input" | "idempotency_conflict" | "not_found" | "forbidden" | "invalid_transition",
    message: string,
  ) {
    super(message);
    this.name = "AiJobStoreError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: string, name: string, maximum: number) {
  if (!value || value.trim() !== value || value.length > maximum) {
    throw new AiJobStoreError("invalid_input", `Invalid ${name}.`);
  }
  return value;
}

function uuid(value: string, name: string) {
  if (!uuidPattern.test(value)) throw new AiJobStoreError("invalid_input", `Invalid ${name}.`);
  return value;
}

function timestamp(value: Date | string): Date {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new AiJobStoreError("invalid_input", "Invalid stored timestamp.");
  }
  return parsed;
}

function job(row: AiJobRow): AiJob {
  return {
    jobId: row.job_id,
    userId: row.user_id,
    kind: row.kind,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    payload: row.payload || {},
    status: row.status,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    availableAt: timestamp(row.available_at),
    lockedAt: row.locked_at === null ? null : timestamp(row.locked_at),
    lockedBy: row.locked_by,
    result: row.result,
    errorCode: row.error_code,
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
    completedAt: row.completed_at === null ? null : timestamp(row.completed_at),
  };
}

export function createAiJobStore(database: ReturnType<typeof createDatabase>) {
  async function enqueue(input: {
    userId: string;
    kind: AiJobKind;
    idempotencyKey: string;
    requestHash: string;
    payload: Record<string, unknown>;
    maxAttempts?: number;
  }): Promise<{ kind: "created" | "existing"; job: AiJob }> {
    const userId = text(input.userId, "user ID", 256);
    const idempotencyKey = text(input.idempotencyKey, "idempotency key", 256);
    const requestHash = text(input.requestHash, "request hash", 256);
    const maxAttempts = Math.max(1, Math.min(10, input.maxAttempts ?? 3));

    return database.client.begin(async (sql) => {
      const inserted = await sql<AiJobRow[]>`
        INSERT INTO system.ai_jobs (
          job_id, user_id, kind, idempotency_key, request_hash, payload, max_attempts
        ) VALUES (
          ${randomUUID()}, ${userId}, ${input.kind}, ${idempotencyKey}, ${requestHash},
          ${json(input.payload)}, ${maxAttempts}
        )
        ON CONFLICT (user_id, kind, idempotency_key) DO NOTHING
        RETURNING *
      `;
      if (inserted[0]) return { kind: "created" as const, job: job(inserted[0]) };

      const existing = await sql<AiJobRow[]>`
        SELECT * FROM system.ai_jobs
        WHERE user_id = ${userId} AND kind = ${input.kind} AND idempotency_key = ${idempotencyKey}
      `;
      if (!existing[0]) throw new AiJobStoreError("not_found", "AI job not found.");
      if (existing[0].request_hash !== requestHash) {
        throw new AiJobStoreError(
          "idempotency_conflict",
          "Idempotency key was already used for a different AI job.",
        );
      }
      return { kind: "existing" as const, job: job(existing[0]) };
    });
  }

  async function getForUser(userIdValue: string, jobIdValue: string): Promise<AiJob> {
    const userId = text(userIdValue, "user ID", 256);
    const jobId = uuid(jobIdValue, "job ID");
    const rows = await database.client<AiJobRow[]>`
      SELECT * FROM system.ai_jobs WHERE job_id = ${jobId}
    `;
    if (!rows[0]) throw new AiJobStoreError("not_found", "AI job not found.");
    if (rows[0].user_id !== userId) {
      throw new AiJobStoreError("forbidden", "AI job belongs to another user.");
    }
    return job(rows[0]);
  }

  async function claim(workerIdValue: string, limitValue = 5): Promise<AiJob[]> {
    const workerId = text(workerIdValue, "worker ID", 128);
    const limit = Math.max(1, Math.min(25, Math.trunc(limitValue)));
    const rows = await database.client<AiJobRow[]>`
      WITH candidates AS (
        SELECT job_id
        FROM system.ai_jobs
        WHERE status IN ('pending', 'retrying')
          AND available_at <= now()
          AND attempts < max_attempts
        ORDER BY available_at, created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      UPDATE system.ai_jobs AS jobs
      SET status = 'processing', attempts = jobs.attempts + 1,
          locked_at = now(), locked_by = ${workerId}, updated_at = now()
      FROM candidates
      WHERE jobs.job_id = candidates.job_id
      RETURNING jobs.*
    `;
    return rows.map(job);
  }

  async function complete(
    workerIdValue: string,
    jobIdValue: string,
    result: Record<string, unknown>,
  ): Promise<AiJob> {
    const workerId = text(workerIdValue, "worker ID", 128);
    const jobId = uuid(jobIdValue, "job ID");
    const rows = await database.client<AiJobRow[]>`
      UPDATE system.ai_jobs
      SET status = 'completed', result = ${json(result)}, error_code = NULL,
          locked_at = NULL, locked_by = NULL, updated_at = now(), completed_at = now()
      WHERE job_id = ${jobId} AND status = 'processing' AND locked_by = ${workerId}
      RETURNING *
    `;
    if (!rows[0]) throw new AiJobStoreError("invalid_transition", "AI job is not owned by this worker.");
    return job(rows[0]);
  }

  async function retryOrFail(
    workerIdValue: string,
    jobIdValue: string,
    errorCodeValue: string,
    delaySecondsValue: number,
  ): Promise<AiJob> {
    const workerId = text(workerIdValue, "worker ID", 128);
    const jobId = uuid(jobIdValue, "job ID");
    const errorCode = text(errorCodeValue, "error code", 128);
    const delaySeconds = Math.max(1, Math.min(3_600, Math.trunc(delaySecondsValue)));
    const rows = await database.client<AiJobRow[]>`
      UPDATE system.ai_jobs
      SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'retrying' END,
          error_code = ${errorCode},
          available_at = CASE
            WHEN attempts >= max_attempts THEN available_at
            ELSE now() + (${delaySeconds} * interval '1 second')
          END,
          locked_at = NULL, locked_by = NULL, updated_at = now(),
          completed_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END
      WHERE job_id = ${jobId} AND status = 'processing' AND locked_by = ${workerId}
      RETURNING *
    `;
    if (!rows[0]) throw new AiJobStoreError("invalid_transition", "AI job is not owned by this worker.");
    return job(rows[0]);
  }

  async function requeueStale(staleSecondsValue = 300): Promise<number> {
    const staleSeconds = Math.max(30, Math.min(3_600, Math.trunc(staleSecondsValue)));
    const rows = await database.client<{ job_id: string }[]>`
      UPDATE system.ai_jobs
      SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'retrying' END,
          error_code = 'worker_lease_expired', available_at = now(),
          locked_at = NULL, locked_by = NULL, updated_at = now(),
          completed_at = CASE WHEN attempts >= max_attempts THEN now() ELSE NULL END
      WHERE status = 'processing'
        AND locked_at < now() - (${staleSeconds} * interval '1 second')
      RETURNING job_id
    `;
    return rows.length;
  }

  return { enqueue, getForUser, claim, complete, retryOrFail, requeueStale };
}

export type AiJobStore = ReturnType<typeof createAiJobStore>;
