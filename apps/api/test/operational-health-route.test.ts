import { describe, expect, it } from "vitest";
import {
  readRuntimeIdentity,
  summarizeOperationalHealth,
} from "../src/operational-health-route.js";

describe("operational health", () => {
  it("reports the exact Railway deployment identity", () => {
    expect(
      readRuntimeIdentity({
        RAILWAY_GIT_COMMIT_SHA: "abc123",
        RAILWAY_DEPLOYMENT_ID: "deployment-1",
        RAILWAY_ENVIRONMENT_NAME: "production",
        RAILWAY_SERVICE_NAME: "@nocturne/api",
        NOCTURNE_RUNTIME_VERSION: "persistent-world-v2",
      }),
    ).toEqual({
      commitSha: "abc123",
      deploymentId: "deployment-1",
      environment: "production",
      service: "@nocturne/api",
      runtimeVersion: "persistent-world-v2",
    });
  });

  it("marks a healthy database, provider, worker, and empty queue ready", () => {
    const now = new Date("2026-08-03T15:30:00.000Z");
    const result = summarizeOperationalHealth({
      now,
      databaseReady: true,
      migrationsReady: true,
      appliedMigrationCount: 27,
      providerConfigured: true,
      workerConfigured: true,
      workerId: "worker-1",
      workerLastSeenAt: new Date("2026-08-03T15:29:55.000Z"),
      queuedCount: 0,
      processingCount: 0,
      oldestQueuedAt: null,
      runtime: readRuntimeIdentity({ RAILWAY_GIT_COMMIT_SHA: "abc123" }),
    });

    expect(result.status).toBe("ready");
    expect(result.dependencies.worker).toMatchObject({ online: true, heartbeatAgeSeconds: 5 });
    expect(result.dependencies.queue.oldestJobAgeSeconds).toBeNull();
  });

  it("reports stale workers and queue age without hiding the deployed commit", () => {
    const now = new Date("2026-08-03T15:30:00.000Z");
    const result = summarizeOperationalHealth({
      now,
      databaseReady: true,
      migrationsReady: true,
      appliedMigrationCount: 27,
      providerConfigured: true,
      workerConfigured: true,
      workerId: "worker-1",
      workerLastSeenAt: new Date("2026-08-03T15:29:30.000Z"),
      queuedCount: 4,
      processingCount: 1,
      oldestQueuedAt: new Date("2026-08-03T15:27:00.000Z"),
      runtime: readRuntimeIdentity({ RAILWAY_GIT_COMMIT_SHA: "def456" }),
    });

    expect(result.status).toBe("degraded");
    expect(result.runtime.commitSha).toBe("def456");
    expect(result.dependencies.worker.online).toBe(false);
    expect(result.dependencies.queue.oldestJobAgeSeconds).toBe(180);
  });
});
