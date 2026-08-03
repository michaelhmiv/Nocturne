import { DEEPSEEK_FLASH_MODEL } from "@nocturne/ai-gm";
import { createDatabase } from "@nocturne/database";
import type { FastifyInstance } from "fastify";

const WORKER_HEARTBEAT_TTL_MS = 20_000;

type RuntimeEnvironment = Record<string, string | undefined>;

type OperationalHealthInput = {
  now: Date;
  databaseReady: boolean;
  migrationsReady: boolean;
  appliedMigrationCount: number;
  providerConfigured: boolean;
  workerConfigured: boolean;
  workerId: string | null;
  workerLastSeenAt: Date | null;
  queuedCount: number;
  processingCount: number;
  oldestQueuedAt: Date | null;
  runtime: ReturnType<typeof readRuntimeIdentity>;
};

export function readRuntimeIdentity(environment: RuntimeEnvironment = process.env) {
  return {
    commitSha:
      environment.RAILWAY_GIT_COMMIT_SHA ||
      environment.GITHUB_SHA ||
      environment.SOURCE_COMMIT ||
      null,
    deploymentId: environment.RAILWAY_DEPLOYMENT_ID || null,
    environment: environment.RAILWAY_ENVIRONMENT_NAME || environment.NODE_ENV || "unknown",
    service: environment.RAILWAY_SERVICE_NAME || "api",
    runtimeVersion: environment.NOCTURNE_RUNTIME_VERSION || "persistent-world-v1",
  };
}

export function summarizeOperationalHealth(input: OperationalHealthInput) {
  const workerAgeMs = input.workerLastSeenAt
    ? Math.max(0, input.now.getTime() - input.workerLastSeenAt.getTime())
    : null;
  const workerOnline = Boolean(
    input.workerLastSeenAt && workerAgeMs !== null && workerAgeMs <= WORKER_HEARTBEAT_TTL_MS,
  );
  const oldestJobAgeSeconds = input.oldestQueuedAt
    ? Math.max(0, Math.floor((input.now.getTime() - input.oldestQueuedAt.getTime()) / 1_000))
    : null;
  const ready =
    input.databaseReady &&
    input.migrationsReady &&
    input.providerConfigured &&
    input.workerConfigured &&
    workerOnline;

  return {
    status: ready ? "ready" : "degraded",
    service: "api",
    runtime: input.runtime,
    dependencies: {
      database: {
        ready: input.databaseReady,
        migrationsReady: input.migrationsReady,
        appliedMigrationCount: input.appliedMigrationCount,
      },
      queue: {
        queuedCount: input.queuedCount,
        processingCount: input.processingCount,
        oldestQueuedAt: input.oldestQueuedAt?.toISOString() ?? null,
        oldestJobAgeSeconds,
      },
      worker: {
        configured: input.workerConfigured,
        online: workerOnline,
        workerId: input.workerId,
        lastSeenAt: input.workerLastSeenAt?.toISOString() ?? null,
        heartbeatAgeSeconds: workerAgeMs === null ? null : Math.floor(workerAgeMs / 1_000),
      },
      provider: {
        provider: "deepseek",
        configured: input.providerConfigured,
        model: DEEPSEEK_FLASH_MODEL,
      },
    },
  };
}

export async function registerOperationalHealthRoute(app: FastifyInstance) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for operational health.");
  const database = createDatabase(databaseUrl);

  app.get("/v1/system/operational-health", async () => {
    let databaseReady = false;
    let migrationsReady = false;
    let appliedMigrationCount = 0;
    let workerId: string | null = null;
    let workerLastSeenAt: Date | null = null;
    let queuedCount = 0;
    let processingCount = 0;
    let oldestQueuedAt: Date | null = null;

    try {
      const [migrationRows, heartbeatRows, queueRows] = await Promise.all([
        database.client`
          SELECT count(*)::int AS applied_count
          FROM system.schema_migrations
        `,
        database.client`
          SELECT worker_id, last_seen_at
          FROM system.worker_heartbeats
          WHERE role = 'ai_job_worker'
          ORDER BY last_seen_at DESC
          LIMIT 1
        `,
        database.client`
          SELECT
            count(*) FILTER (WHERE status IN ('pending', 'retrying'))::int AS queued_count,
            count(*) FILTER (WHERE status = 'processing')::int AS processing_count,
            min(created_at) FILTER (WHERE status IN ('pending', 'retrying')) AS oldest_queued_at
          FROM system.ai_jobs
        `,
      ]);
      databaseReady = true;
      migrationsReady = true;
      appliedMigrationCount = Number(migrationRows[0]?.applied_count || 0);
      workerId = heartbeatRows[0]?.worker_id ? String(heartbeatRows[0].worker_id) : null;
      workerLastSeenAt = heartbeatRows[0]?.last_seen_at
        ? new Date(String(heartbeatRows[0].last_seen_at))
        : null;
      queuedCount = Number(queueRows[0]?.queued_count || 0);
      processingCount = Number(queueRows[0]?.processing_count || 0);
      oldestQueuedAt = queueRows[0]?.oldest_queued_at
        ? new Date(String(queueRows[0].oldest_queued_at))
        : null;
    } catch (error) {
      app.log.error(
        {
          err: error,
          errorClass: "readiness_failure",
          executionStage: "operational_health",
          commitSha: readRuntimeIdentity().commitSha,
        },
        "operational health query failed",
      );
    }

    return summarizeOperationalHealth({
      now: new Date(),
      databaseReady,
      migrationsReady,
      appliedMigrationCount,
      providerConfigured: Boolean(process.env.DEEPSEEK_API_KEY),
      workerConfigured: Boolean(process.env.AI_JOB_WORKER_SECRET),
      workerId,
      workerLastSeenAt,
      queuedCount,
      processingCount,
      oldestQueuedAt,
      runtime: readRuntimeIdentity(),
    });
  });

  app.addHook("onClose", async () => database.close());
}
