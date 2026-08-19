import { describe, expect, it, vi } from "vitest";
import { createNocturneTools } from "../apps/mcp/src/tools.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ChatGPT player-facing MCP contract", () => {
  it("uses player-facing metadata instead of certification-harness language", () => {
    const tools = createNocturneTools(
      {
        apiBaseUrl: "https://api.example.test",
        apiAuthMode: "bearer",
        apiBearerToken: "test-token",
        requestTimeoutMs: 10_000,
      } as never,
      vi.fn() as never,
    );
    const byName = new Map(tools.map((tool) => [tool.name, tool]));

    expect(byName.get("create_character")?.title).toBe("Create character");
    expect(byName.get("submit_action")?.description).toContain("natural-language player action");
    expect(byName.get("submit_action")?.description).toContain("fixed command catalog");
    expect(byName.get("get_operator_dashboard")?.description).toContain("Diagnostic");
    expect(byName.get("nocturne_health")?.description).toContain(
      "not as part of ordinary gameplay",
    );

    const publicText = tools
      .map((tool) => `${tool.title} ${tool.description}`)
      .join("\n")
      .toLowerCase();
    expect(publicText).not.toContain("create test character");
    expect(publicText).not.toContain("for a test actor");
    expect(publicText).not.toContain("running gameplay tests");
    expect(publicText).not.toContain("tests the llm interpretation");
  });

  it("attributes characters created through ChatGPT to chatgpt provenance", async () => {
    const requests: Array<{ url: string; method: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method || (input instanceof Request ? input.method : "GET");
      const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      requests.push({ url, method, body });
      return jsonResponse({ id: "11111111-1111-4111-8111-111111111111" }, 201);
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
    const createCharacter = tools.find((tool) => tool.name === "create_character")!;

    await createCharacter.execute({
      name: "Player Character",
      conceptSummary: "A new resident trying to make a life in the city.",
      idempotencyKey: "chatgpt-character-contract",
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: "https://api.example.test/v1/characters",
      method: "POST",
      body: {
        name: "Player Character",
        conceptSummary: "A new resident trying to make a life in the city.",
        originSource: "chatgpt",
      },
    });
  });
});
