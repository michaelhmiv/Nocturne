import { describe, expect, it, vi } from "vitest";
import { createNocturneTools } from "../apps/mcp/src/tools.js";
import { SEMANTIC_ACTION_CORPUS } from "./action-matrix/semantic-action-corpus.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("MCP semantic action corpus", () => {
  it("forwards every natural-language action exactly once through submit_action", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method || (input instanceof Request ? input.method : "GET");
      const rawBody = init?.body;
      const body = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody ?? null;
      requests.push({ url, method, body });
      if (url.endsWith("/v1/characters")) {
        return jsonResponse({
          characters: [
            {
              id: "87108c7a-43de-4f82-a50a-b711c1b5d94f",
              selected: true,
              name: "MCP Corpus Agent",
            },
          ],
        });
      }
      if (url.includes("/v1/persistent-world/actions")) {
        return jsonResponse({
          requestId: "11111111-1111-4111-8111-111111111111",
          state: "completed",
          narration: "Action accepted by the persistent-world runtime.",
          plan: { status: "completed", steps: [] },
        });
      }
      return jsonResponse({ status: "ok" });
    });
    const tools = createNocturneTools(
      {
        apiBaseUrl: "https://api.example.test",
        apiAuthMode: "bearer",
        apiBearerToken: "test-token",
        requestTimeoutMs: 10_000,
      } as never,
      fetchImpl as never,
    );
    const submit = tools.find(({ name }) => name === "submit_action");
    expect(submit).toBeDefined();

    for (const testCase of SEMANTIC_ACTION_CORPUS) {
      const before = requests.filter(({ url }) =>
        url.includes("/v1/persistent-world/actions"),
      ).length;
      const result = await submit!.execute({ command: testCase.prompt });
      expect(result).toBeTruthy();
      const actionRequests = requests.filter(({ url }) =>
        url.includes("/v1/persistent-world/actions"),
      );
      expect(actionRequests).toHaveLength(before + 1);
      const latest = actionRequests.at(-1)!;
      expect(latest.method).toBe("POST");
      expect(latest.body).toMatchObject({ command: testCase.prompt });
    }
  });

  it("never converts corpus prompts into a fixed catalog command at the MCP boundary", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/v1/persistent-world/actions") && typeof init?.body === "string") {
        bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      }
      return jsonResponse({ state: "completed", narration: "ok", plan: { status: "completed" } });
    });
    const tools = createNocturneTools(
      {
        apiBaseUrl: "https://api.example.test",
        apiAuthMode: "bearer",
        apiBearerToken: "test-token",
        requestTimeoutMs: 10_000,
      } as never,
      fetchImpl as never,
    );
    const submit = tools.find(({ name }) => name === "submit_action")!;
    const prompts = [
      "Do one push up.",
      "Use it on him.",
      "Repair the engine for two hours.",
      "Walk through the solid wall.",
    ];
    for (const prompt of prompts) await submit.execute({ command: prompt });
    expect(bodies.map((body) => body.command)).toEqual(prompts);
    expect(bodies.every((body) => !("actionType" in body))).toBe(true);
  });
});
