import { randomUUID } from "node:crypto";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";
import type { WorldScope } from "./world-store.js";

export type ScheduledWorkClaim = {
  scheduleId: string;
  worldId: string;
  shardId: string;
  idempotencyKey: string;
  kind: string;
  payload: Record<string, unknown>;
  subjectEntityIds: string[];
  expectedVersions: Record<string, number>;
  resolutionPolicy: string;
  planId: string | null;
  stepId: string | null;
  attemptNumber: number;
  leaseExpiresAt: string;
};

export class ScheduledWorkStoreError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "not_claimed"
      | "lease_expired"
      | "stale_result"
      | "invalid_state",
    message: string,
  ) {
    super(message);
    this.name = "ScheduledWorkStoreError";
  }
}

export function createScheduledWorkStore(database: ReturnType<typeof createDatabase>) {
  async function claimDue(input: {
    workerId: string;
    limit?: number;
    leaseSeconds?: number;
  }): Promise<ScheduledWorkClaim[]> {
    const limit = Math.max(1, Math.min(input.limit || 10, 50));
    const leaseSeconds = Math.max(15, Math.min(input.leaseSeconds || 120, 900));
    return database.client.begin(async (sql) => {
      await sql`
        UPDATE game.scheduled_actions
        SET status = 'retrying', worker_id = NULL, lease_expires_at = NULL,
            available_at = now(), updated_at = now(),
            last_error_code = COALESCE(last_error_code, 'stale_worker_lease'),
            retryable = true
        WHERE status = 'resolving'
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at < now()
          AND attempt_count < max_attempts
      `;
      await sql`
        UPDATE game.scheduled_actions
        SET status = 'failed', worker_id = NULL, lease_expires_at = NULL,
            completed_at = now(), updated_at = now(),
            last_error_code = COALESCE(last_error_code, 'attempts_exhausted'),
            retryable = false
        WHERE status = 'resolving'
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at < now()
          AND attempt_count >= max_attempts
      `;
      const rows = await sql<
        {
          schedule_id: string;
          world_id: string;
          shard_id: string;
          idempotency_key: string;
          kind: string;
          payload: Record<string, unknown>;
          subject_entity_ids: string[];
          expected_versions: Record<string, number>;
          resolution_policy: string;
          plan_id: string | null;
          step_id: string | null;
          attempt_count: number;
          lease_expires_at: Date;
        }[]
      >`
        UPDATE game.scheduled_actions action
        SET status = 'resolving',
            worker_id = ${input.workerId},
            lease_expires_at = now() + (${leaseSeconds}::text || ' seconds')::interval,
            attempt_count = action.attempt_count + 1,
            updated_at = now()
        WHERE action.schedule_id IN (
          SELECT candidate.schedule_id
          FROM game.scheduled_actions candidate
          WHERE candidate.status IN ('pending', 'retrying')
            AND candidate.resolves_at <= now()
            AND candidate.available_at <= now()
            AND candidate.attempt_count < candidate.max_attempts
          ORDER BY candidate.resolves_at, candidate.created_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING action.schedule_id, action.world_id, action.shard_id,
                  action.idempotency_key, action.kind, action.payload,
                  action.subject_entity_ids, action.expected_versions,
                  action.resolution_policy, action.plan_id, action.step_id,
                  action.attempt_count, action.lease_expires_at
      `;
      for (const row of rows) {
        await sql`
          INSERT INTO game.scheduled_action_attempts (
            attempt_id, schedule_id, attempt_number, worker_id, status, metadata
          ) VALUES (
            ${randomUUID()}, ${row.schedule_id}, ${row.attempt_count},
            ${input.workerId}, 'running',
            ${json({ leaseExpiresAt: row.lease_expires_at.toISOString() })}::jsonb
          )
        `;
      }
      return rows.map((row) => ({
        scheduleId: row.schedule_id,
        worldId: row.world_id,
        shardId: row.shard_id,
        idempotencyKey: row.idempotency_key,
        kind: row.kind,
        payload: row.payload || {},
        subjectEntityIds: row.subject_entity_ids || [],
        expectedVersions: row.expected_versions || {},
        resolutionPolicy: row.resolution_policy,
        planId: row.plan_id,
        stepId: row.step_id,
        attemptNumber: row.attempt_count,
        leaseExpiresAt: row.lease_expires_at.toISOString(),
      }));
    });
  }

  async function complete(input: {
    workerId: string;
    scheduleId: string;
    attemptNumber: number;
    resultEventId: string;
    metadata?: Record<string, unknown>;
  }) {
    return database.client.begin(async (sql) => {
      const rows = await sql<{ result_event_id: string | null }[]>`
        SELECT result_event_id
        FROM game.scheduled_actions
        WHERE schedule_id = ${input.scheduleId}
        FOR UPDATE
      `;
      if (!rows[0]) throw new ScheduledWorkStoreError("not_found", "Scheduled work not found.");
      if (rows[0].result_event_id) {
        if (rows[0].result_event_id !== input.resultEventId) {
          throw new ScheduledWorkStoreError("stale_result", "Scheduled work already has another result.");
        }
        return { idempotentReplay: true };
      }
      const updated = await sql`
        UPDATE game.scheduled_actions
        SET status = 'resolved', result_event_id = ${input.resultEventId},
            completed_at = now(), updated_at = now(), worker_id = NULL,
            lease_expires_at = NULL, retryable = false
        WHERE schedule_id = ${input.scheduleId}
          AND status = 'resolving'
          AND worker_id = ${input.workerId}
          AND attempt_count = ${input.attemptNumber}
          AND lease_expires_at >= now()
        RETURNING schedule_id
      `;
      if (!updated[0]) {
        throw new ScheduledWorkStoreError(
          "lease_expired",
          "Scheduled work lease is missing or expired.",
        );
      }
      await sql`
        UPDATE game.scheduled_action_attempts
        SET status = 'completed', result_event_id = ${input.resultEventId},
            completed_at = now(), metadata = metadata || ${json(input.metadata || {})}::jsonb
        WHERE schedule_id = ${input.scheduleId}
          AND attempt_number = ${input.attemptNumber}
          AND worker_id = ${input.workerId}
          AND status = 'running'
      `;
      return { idempotentReplay: false };
    });
  }

  async function retryOrFail(input: {
    workerId: string;
    scheduleId: string;
    attemptNumber: number;
    errorCode: string;
    retryable: boolean;
    retryDelaySeconds?: number;
    metadata?: Record<string, unknown>;
  }) {
    const delay = Math.max(0, Math.min(input.retryDelaySeconds || 0, 86_400));
    return database.client.begin(async (sql) => {
      const rows = await sql<{ attempt_count: number; max_attempts: number }[]>`
        SELECT attempt_count, max_attempts
        FROM game.scheduled_actions
        WHERE schedule_id = ${input.scheduleId}
          AND status = 'resolving'
          AND worker_id = ${input.workerId}
          AND attempt_count = ${input.attemptNumber}
        FOR UPDATE
      `;
      const action = rows[0];
      if (!action) {
        throw new ScheduledWorkStoreError("not_claimed", "Scheduled work is not claimed by this worker.");
      }
      const shouldRetry = input.retryable && action.attempt_count < action.max_attempts;
      await sql`
        UPDATE game.scheduled_actions
        SET status = ${shouldRetry ? "retrying" : "failed"},
            worker_id = NULL,
            lease_expires_at = NULL,
            last_error_code = ${input.errorCode},
            retryable = ${shouldRetry},
            available_at = CASE
              WHEN ${shouldRetry} THEN now() + (${delay}::text || ' seconds')::interval
              ELSE available_at
            END,
            completed_at = CASE WHEN ${shouldRetry} THEN NULL ELSE now() END,
            updated_at = now()
        WHERE schedule_id = ${input.scheduleId}
      `;
      await sql`
        UPDATE game.scheduled_action_attempts
        SET status = ${shouldRetry ? "retrying" : "failed"},
            error_code = ${input.errorCode}, completed_at = now(),
            metadata = metadata || ${json(input.metadata || {})}::jsonb
        WHERE schedule_id = ${input.scheduleId}
          AND attempt_number = ${input.attemptNumber}
          AND worker_id = ${input.workerId}
      `;
      return { status: shouldRetry ? ("retrying" as const) : ("failed" as const) };
    });
  }

  async function getScope(scheduleId: string): Promise<Pick<WorldScope, "worldId" | "shardId">> {
    const rows = await database.client<{ world_id: string; shard_id: string }[]>`
      SELECT world_id, shard_id
      FROM game.scheduled_actions
      WHERE schedule_id = ${scheduleId}
    `;
    if (!rows[0]) throw new ScheduledWorkStoreError("not_found", "Scheduled work not found.");
    return { worldId: rows[0].world_id, shardId: rows[0].shard_id };
  }

  return { claimDue, complete, retryOrFail, getScope };
}

export type ScheduledWorkStore = ReturnType<typeof createScheduledWorkStore>;
