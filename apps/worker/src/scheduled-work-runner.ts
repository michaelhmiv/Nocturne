import type { ScheduledWorkStore } from "@nocturne/database";

export type ScheduledWorkerApiError = Error & {
  code?: string;
  retryable?: boolean;
  status?: number;
};

async function requestResolution(input: {
  apiUrl: string;
  workerSecret: string;
  workerId: string;
  scheduleId: string;
  attemptNumber: number;
}) {
  const response = await fetch(
    `${input.apiUrl}/v1/internal/scheduled-actions/${input.scheduleId}/resolve`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nocturne-worker-secret": input.workerSecret,
      },
      body: JSON.stringify({
        workerId: input.workerId,
        attemptNumber: input.attemptNumber,
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  const text = await response.text();
  let payload: unknown = text;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {}
  const record =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  if (!response.ok) {
    const error = new Error(
      `Scheduled work API failed: ${String(record?.message || record?.error || response.status)}`,
    ) as ScheduledWorkerApiError;
    error.code = String(record?.error || `http_${response.status}`);
    error.retryable = typeof record?.retryable === "boolean" ? record.retryable : response.status >= 500;
    error.status = response.status;
    throw error;
  }
  const eventId = typeof record?.eventId === "string" ? record.eventId : null;
  if (!eventId) throw new Error("Scheduled work API returned no authoritative result event.");
  return { eventId };
}

function retryDelay(attemptNumber: number) {
  return Math.min(300, 5 * 2 ** Math.max(0, attemptNumber - 1));
}

export function createScheduledWorkRunner(input: {
  store: ScheduledWorkStore;
  apiUrl: string;
  workerSecret: string;
  workerId: string;
  log: (record: Record<string, unknown>) => void;
  error: (record: Record<string, unknown>) => void;
}) {
  async function tick() {
    const claims = await input.store.claimDue({ workerId: input.workerId, limit: 10, leaseSeconds: 180 });
    for (const claim of claims) {
      try {
        const result = await requestResolution({
          apiUrl: input.apiUrl,
          workerSecret: input.workerSecret,
          workerId: input.workerId,
          scheduleId: claim.scheduleId,
          attemptNumber: claim.attemptNumber,
        });
        const completed = await input.store.complete({
          workerId: input.workerId,
          scheduleId: claim.scheduleId,
          attemptNumber: claim.attemptNumber,
          resultEventId: result.eventId,
          metadata: { kind: claim.kind, resolutionPolicy: claim.resolutionPolicy },
        });
        input.log({
          level: "info",
          service: "worker",
          message: "scheduled_work_resolved",
          schedule_id: claim.scheduleId,
          kind: claim.kind,
          attempt: claim.attemptNumber,
          event_id: result.eventId,
          idempotent_replay: completed.idempotentReplay,
        });
      } catch (error) {
        const coded = error as ScheduledWorkerApiError;
        const retryable = coded.retryable ?? true;
        const errorCode = coded.code || "scheduled_resolution_failed";
        const updated = await input.store.retryOrFail({
          workerId: input.workerId,
          scheduleId: claim.scheduleId,
          attemptNumber: claim.attemptNumber,
          errorCode,
          retryable,
          retryDelaySeconds: retryDelay(claim.attemptNumber),
          metadata: {
            kind: claim.kind,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        input.error({
          level: "error",
          service: "worker",
          message:
            updated.status === "retrying"
              ? "scheduled_work_retry_scheduled"
              : "scheduled_work_failed",
          schedule_id: claim.scheduleId,
          kind: claim.kind,
          attempt: claim.attemptNumber,
          retryable,
          error_code: errorCode,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return { tick };
}
