import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  createDatabase,
  createPersistentPlanStore,
  createRelationshipStore,
  createUniversalOperationExecutor,
  type ScheduledWorkClaim,
} from "@nocturne/database";
import { z } from "zod";
import { createScheduledWorkService, ScheduledWorkServiceError } from "./scheduled-work-service.js";

const paramsSchema = z.object({ scheduleId: z.string().uuid() }).strict();
const bodySchema = z
  .object({
    workerId: z.string().trim().min(1).max(300),
    attemptNumber: z.number().int().positive(),
  })
  .strict();

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function registerScheduledWorkRoutesFromEnv(app: FastifyInstance) {
  const databaseUrl = process.env.DATABASE_URL;
  const workerSecret = process.env.AI_JOB_WORKER_SECRET;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for scheduled-work routes.");
  if (!workerSecret) throw new Error("AI_JOB_WORKER_SECRET is required for scheduled-work routes.");

  const database = createDatabase(databaseUrl);
  const executor = createUniversalOperationExecutor(database);
  const plans = createPersistentPlanStore(database);
  const relationships = createRelationshipStore(database, executor);
  const service = createScheduledWorkService({ database, executor, plans, relationships });

  app.addHook("onClose", async () => {
    await database.close();
  });

  app.post("/v1/internal/scheduled-actions/:scheduleId/resolve", async (request, reply) => {
    const suppliedSecret = String(request.headers["x-nocturne-worker-secret"] || "");
    if (!safeEqual(suppliedSecret, workerSecret)) {
      return reply.code(403).send({ error: "forbidden", retryable: false });
    }
    const { scheduleId } = paramsSchema.parse(request.params);
    const { workerId, attemptNumber } = bodySchema.parse(request.body);
    const rows = await database.client<
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
      SELECT schedule_id, world_id, shard_id, idempotency_key, kind, payload,
             subject_entity_ids, expected_versions, resolution_policy,
             plan_id, step_id, attempt_count, lease_expires_at
      FROM game.scheduled_actions
      WHERE schedule_id = ${scheduleId}
        AND status = 'resolving'
        AND worker_id = ${workerId}
        AND attempt_count = ${attemptNumber}
        AND lease_expires_at >= now()
    `;
    const row = rows[0];
    if (!row) {
      return reply.code(409).send({
        error: "scheduled_lease_invalid",
        message: "Scheduled work is not held by this worker attempt.",
        retryable: false,
      });
    }
    const claim: ScheduledWorkClaim = {
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
    };
    try {
      const result = await service.resolve(claim);
      return reply.send({
        scheduleId,
        eventId: result.eventId,
        retryable: false,
      });
    } catch (error) {
      const code =
        error instanceof ScheduledWorkServiceError ? error.code : "scheduled_resolution_failed";
      const retryable = ![
        "unsupported_kind",
        "stale_state",
        "superseded",
        "target_missing",
        "domain_rejection",
      ].includes(code);
      return reply.code(retryable ? 500 : 422).send({
        error: code,
        message:
          error instanceof Error ? error.message.slice(0, 2_000) : "Scheduled resolution failed.",
        retryable,
      });
    }
  });
}
