import { afterEach, describe, expect, it, vi } from "vitest";
import { gameFetch } from "../app/game-fetch";

afterEach(() => vi.unstubAllGlobals());

describe("gameFetch", () => {
  it("forwards guest mode and custom headers", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await gameFetch("actions", { headers: { "idempotency-key": "one" } }, true);

    const [path, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(path).toBe("/api/game/actions");
    expect(headers.get("idempotency-key")).toBe("one");
    expect(headers.get("x-nocturne-guest-mode")).toBe("1");
  });

  it("preserves the legacy web history while retaining canonical records", async () => {
    const canonical = [{ requestId: "request-1", command: "Scan the room", status: "completed" }];
    const legacy = [
      {
        eventId: "event-1",
        rawText: "Scan the room",
        outcomeGrade: "complete_success",
        narration: "The room is clear.",
        calculationTrace: [],
        informationGained: [],
        costs: [],
        createdAt: "2026-08-03T16:00:00.000Z",
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ actions: canonical, legacyActions: legacy })),
    );

    const result = await gameFetch<{
      actions: typeof legacy;
      canonicalActions: typeof canonical;
      legacyActions: typeof legacy;
    }>("actions?actorId=40000000-0000-4000-8000-000000000001");

    expect(result.actions).toEqual(legacy);
    expect(result.canonicalActions).toEqual(canonical);
    expect(result.legacyActions).toEqual(legacy);
  });

  it("preserves a non-JSON upstream error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream unavailable", { status: 502 })),
    );

    await expect(gameFetch("actions")).rejects.toThrow("upstream unavailable");
  });

  it("renders validation issue paths instead of an issue count", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "invalid_request", issues: [{ path: ["rawConcept"], message: "Required" }] },
          { status: 400 },
        ),
      ),
    );

    await expect(gameFetch("ai-jobs/inventions")).rejects.toThrow("rawConcept: Required");
  });

  it("hides provider terminology behind a game-safe message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: "provider_failure", message: "secret provider detail" },
          { status: 502 },
        ),
      ),
    );

    await expect(gameFetch("ai-jobs/actions")).rejects.toThrow(
      "Nocturne could not resolve this turn yet",
    );
  });
});
