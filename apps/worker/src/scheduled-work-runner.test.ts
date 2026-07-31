import { afterEach, describe, expect, it, vi } from "vitest";
import { createScheduledWorkRunner } from "./scheduled-work-runner.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("authoritative scheduled work runner", () => {
  it("completes a claimed action with the API result event", async () => {
    const complete = vi.fn().mockResolvedValue({ idempotentReplay: false });
    const retryOrFail = vi.fn();
    const store = {
      claimDue: vi.fn().mockResolvedValue([
        {
          scheduleId: "10000000-0000-4000-8000-000000000001",
          worldId: "10000000-0000-4000-8000-000000000002",
          shardId: "10000000-0000-4000-8000-000000000003",
          idempotencyKey: "travel:1",
          kind: "move",
          payload: {},
          subjectEntityIds: [],
          expectedVersions: {},
          resolutionPolicy: "authoritative-v1",
          planId: null,
          stepId: null,
          attemptNumber: 1,
          leaseExpiresAt: "2026-07-31T03:00:00.000Z",
        },
      ]),
      complete,
      retryOrFail,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ eventId: "20000000-0000-4000-8000-000000000001" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const runner = createScheduledWorkRunner({
      store: store as never,
      apiUrl: "http://api",
      workerSecret: "secret",
      workerId: "worker:1",
      log: vi.fn(),
      error: vi.fn(),
    });
    await runner.tick();
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        resultEventId: "20000000-0000-4000-8000-000000000001",
      }),
    );
    expect(retryOrFail).not.toHaveBeenCalled();
  });

  it("does not retry terminal domain rejections", async () => {
    const retryOrFail = vi.fn().mockResolvedValue({ status: "failed" });
    const store = {
      claimDue: vi.fn().mockResolvedValue([
        {
          scheduleId: "10000000-0000-4000-8000-000000000001",
          worldId: "10000000-0000-4000-8000-000000000002",
          shardId: "10000000-0000-4000-8000-000000000003",
          idempotencyKey: "travel:1",
          kind: "move",
          payload: {},
          subjectEntityIds: [],
          expectedVersions: {},
          resolutionPolicy: "authoritative-v1",
          planId: null,
          stepId: null,
          attemptNumber: 1,
          leaseExpiresAt: "2026-07-31T03:00:00.000Z",
        },
      ]),
      complete: vi.fn(),
      retryOrFail,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "stale_state", retryable: false }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const runner = createScheduledWorkRunner({
      store: store as never,
      apiUrl: "http://api",
      workerSecret: "secret",
      workerId: "worker:1",
      log: vi.fn(),
      error: vi.fn(),
    });
    await runner.tick();
    expect(retryOrFail).toHaveBeenCalledWith(
      expect.objectContaining({ retryable: false, errorCode: "stale_state" }),
    );
  });
});
