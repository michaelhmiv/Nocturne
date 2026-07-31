import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import { getSessionFromNodeHeaders } from "@nocturne/auth";
import {
  AiJobStoreError,
  createActionStore,
  createAgentStore,
  createAiJobStore,
  createConsumptionStore,
  createDatabase,
  createInventionStore,
  createLocationStore,
  PersistentWorldError,
  serializeJson,
  type AiJob,
  type AiJobKind,
} from "@nocturne/database";
import {
  ActionPlanEnvelopeSchema,
  NormalizeContentRequestSchema,
  SubmitActionRequestSchema,
} from "@nocturne/contracts";
import { z } from "zod";
import { createActionPlanService } from "./action-plan-service.js";
import { createActionService } from "./action-service.js";
import { createInventionService } from "./invention-service.js";

const idempotencySchema = z.string().trim().min(1).max(256);
const jobIdSchema = z.string().uuid();
const WORKER_HEARTBEAT_TTL_MS = 20_000;

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function publicJob(job: AiJob) {
  return {
    jobId: job.jobId,
    kind: job.kind,
    status: job.status,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
    result: job.result,
    errorCode: job.errorCode,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}

function sendStoreError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof AiJobStoreError)) throw error;
  const status =
    error.code === "not_found"
      ? 404
      : error.code === "forbidden"
        ? 403
        : error.code === "idempotency_conflict" || error.code === "invalid_transition"
          ? 409
          : 422;
  return reply.code(status).send({ error: error.code, message: error.message });
}

type CodedError = Error & { code?: unknown };

function sendInternalJobError(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : "Internal AI job execution failed.";
  const sourceCode =
    error instanceof Error && typeof (error as CodedError).code === "string"
      ? String((error as CodedError).code)
      : "internal_error";

  const policy =
    sourceCode === "validation"
      ? { error: "ai_validation_failed", retryable: false, status: 422 }
      : sourceCode === "configuration"
        ? { error: "ai_configuration_missing", retryable: false, status: 503 }
        : sourceCode === "provider_rejected"
          ? { error: "provider_rejected", retryable: false, status: 422 }
          : sourceCode === "timeout"
            ? { error: "provider_timeout", retryable: true, status: 504 }
            : sourceCode === "rate_limited"
              ? { error: "provider_rate_limited", retryable: true, status: 503 }
              : sourceCode === "provider_failure" || sourceCode === "malformed_response"
                ? { error: sourceCode, retryable: true, status: 502 }
                : [
                      "invalid_analysis",
                      "forbidden",
                      "not_found",
                      "unavailable",
                      "duplicate",
                      "invalid_transition",
                      "idempotency_conflict",
                    ].includes(sourceCode)
                  ? { error: sourceCode, retryable: false, status: 422 }
                  : { error: "internal_error", retryable: true, status: 500 };

  return reply.code(policy.status).send({
    error: policy.error,
    message: message.slice(0, 2_000),
    retryable: policy.retryable,
  });
}

export async function registerAiJobRoutesFromEnv(app: FastifyInstance) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for AI job routes.");
  const database = createDatabase(databaseUrl);
  const jobs = createAiJobStore(database);
  const agents = createAgentStore(database);
  const locations = createLocationStore(database);
  const consumption = createConsumptionStore(database);
  const actionStore = createActionStore(database);
  const actions = createActionService(actionStore, process.env, locations, consumption);
  const actionPlans = createActionPlanService(actionStore, actions, process.env);
  const inventions = createInventionService(createInventionStore(database), process.env);

  async function requireUser(headers: Record<string, string | string[] | undefined>) {
    const authorization = headers.authorization;
    const bearer = Array.isArray(authorization) ? authorization[0] : authorization;
    const agent = await agents.authenticate(bearer);
    if (agent) return { id: agent.userId };
    if (
      process.env.NOCTURNE_GUEST_MODE === "true" &&
      headers["x-nocturne-guest-mode"] === "1"
    ) {
      return { id: process.env.NOCTURNE_GUEST_USER_ID || "nocturne-test-guest" };
    }
    const session = await getSessionFromNodeHeaders(headers);
    if (!session) throw new PersistentWorldError("forbidden", "Authentication is required.");
    return session.user;
  }

  async function enqueue(
    userId: string,
    kind: AiJobKind,
    idempotencyKey: string,
    input: Record<string, unknown>,
    maxAttempts: number,
  ) {
    return jobs.enqueue({
      userId,
      kind,
      idempotencyKey,
      requestHash: hash({ kind, input }),
      payload: { userId, input, idempotencyKey },
      maxAttempts,
    });
  }

  app.post("/v1/ai-jobs/actions", async (request, reply) => {
    const user = await requireUser(request.headers);
    const input = SubmitActionRequestSchema.parse(request.body);
    const idempotencyKey = idempotencySchema.parse(request.headers["idempotency-key"]);
    try {
      const reserved = await enqueue(
        user.id,
        "action_resolution",
        idempotencyKey,
        input,
        3,
      );
      return reply.code(reserved.job.status === "completed" ? 200 : 202).send(publicJob(reserved.job));
    } catch (error) {
      return sendStoreError(reply, error);
    }
  });

  app.post("/v1/ai-jobs/inventions", async (request, reply) => {
    const user = await requireUser(request.headers);
    const input = NormalizeContentRequestSchema.parse(request.body);
    const idempotencyKey = idempotencySchema.parse(
      request.headers["idempotency-key"] || randomUUID(),
    );
    try {
      const reserved = await enqueue(
        user.id,
        "invention_normalization",
        idempotencyKey,
        input,
        1,
      );
      return reply.code(reserved.job.status === "completed" ? 200 : 202).send(publicJob(reserved.job));
    } catch (error) {
      return sendStoreError(reply, error);
    }
  });

  app.get("/v1/ai-jobs/health", async (request) => {
    const user = await requireUser(request.headers);
    const heartbeatRows = await database.client`
      SELECT worker_id, last_seen_at
      FROM system.worker_heartbeats
      WHERE role = 'ai_job_worker'
      ORDER BY last_seen_at DESC
      LIMIT 1
    `;
    const queueRows = await database.client`
      SELECT
        count(*) FILTER (WHERE status IN ('pending', 'retrying'))::int AS queued_count,
        count(*) FILTER (WHERE status = 'processing')::int AS processing_count,
        min(created_at) FILTER (WHERE status IN ('pending', 'retrying')) AS oldest_queued_at
      FROM system.ai_jobs
      WHERE user_id = ${user.id}
    `;

    const heartbeat = heartbeatRows[0];
    const lastSeenAt = heartbeat?.last_seen_at ? new Date(String(heartbeat.last_seen_at)) : null;
    const workerOnline = Boolean(
      lastSeenAt && Date.now() - lastSeenAt.getTime() <= WORKER_HEARTBEAT_TTL_MS,
    );
    const queue = queueRows[0] || {};

    return {
      workerOnline,
      workerConfigured: Boolean(process.env.AI_JOB_WORKER_SECRET),
      workerId: heartbeat?.worker_id ? String(heartbeat.worker_id) : null,
      lastSeenAt: lastSeenAt?.toISOString() ?? null,
      queuedCount: Number(queue.queued_count || 0),
      processingCount: Number(queue.processing_count || 0),
      oldestQueuedAt: queue.oldest_queued_at
        ? new Date(String(queue.oldest_queued_at)).toISOString()
        : null,
    };
  });

  app.get<{ Params: { jobId: string } }>("/v1/ai-jobs/:jobId", async (request, reply) => {
    const user = await requireUser(request.headers);
    const jobId = jobIdSchema.parse(request.params.jobId);
    try {
      return publicJob(await jobs.getForUser(user.id, jobId));
    } catch (error) {
      return sendStoreError(reply, error);
    }
  });

  app.post<{ Params: { jobId: string } }>(
    "/v1/internal/ai-jobs/:jobId/run",
    async (request, reply) => {
      const jobId = jobIdSchema.parse(request.params.jobId);
      const configuredSecret = process.env.AI_JOB_WORKER_SECRET;
      const supplied = request.headers["x-nocturne-worker-secret"];
      const suppliedSecret = Array.isArray(supplied) ? supplied[0] : supplied;
      if (!configuredSecret || !suppliedSecret || !safeEqual(configuredSecret, suppliedSecret)) {
        return reply.code(403).send({ error: "forbidden", retryable: false });
      }

      const body = z
        .object({
          kind: z.enum(["action_resolution", "invention_normalization"]),
          payload: z.object({
            userId: z.string().min(1).max(256),
            input: z.record(z.string(), z.unknown()),
            idempotencyKey: z.string().min(1).max(256),
          }),
        })
        .parse(request.body);

      try {
        if (body.kind === "action_resolution") {
          const claimedJob = await jobs.getForUser(body.payload.userId, jobId);
          if (
            claimedJob.kind !== body.kind ||
            claimedJob.idempotencyKey !== body.payload.idempotencyKey
          ) {
            throw new AiJobStoreError(
              "invalid_transition",
              "Claimed AI job does not match the supplied resolution payload.",
            );
          }
          const storedPlan = ActionPlanEnvelopeSchema.safeParse(claimedJob.payload.plan);
          return await actionPlans.execute(
            body.payload.userId,
            body.payload.input,
            body.payload.idempotencyKey,
            {
              ...(storedPlan.success ? { existingPlan: storedPlan.data } : {}),
              persistPlan: async (plan) => {
                await database.client`
                  UPDATE system.ai_jobs
                  SET payload = jsonb_set(
                        payload,
                        '{plan}',
                        ${serializeJson(plan)}::jsonb,
                        true
                      ),
                      updated_at = now()
                  WHERE job_id = ${jobId}
                    AND user_id = ${body.payload.userId}
                    AND kind = 'action_resolution'
                `;
              },
            },
          );
        }
        return await inventions.normalize(body.payload.userId, body.payload.input);
      } catch (error) {
        app.log.error(error);
        return sendInternalJobError(reply, error);
      }
    },
  );

  app.addHook("onClose", async () => database.close());
}
