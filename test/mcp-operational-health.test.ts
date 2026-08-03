import { describe, expect, it, vi } from "vitest";
import type { McpConfig } from "../apps/mcp/src/config.js";
import { createNocturneTools } from "../apps/mcp/src/tools.js";

const config: McpConfig = {
  host: "127.0.0.1",
  port: 0,
  publicBaseUrl: "https://mcp.example.test",
  apiBaseUrl: "https://api.example.test",
  apiAuthMode: "guest",
  oauthSigningSecret: "test-signing-secret-test-signing-secret",
  adminPassword: "correct horse battery staple",
  allowedRedirectHosts: new Set(["chatgpt.com"]),
  accessTokenTtlSeconds: 3600,
  refreshTokenTtlSeconds: 86400,
  requestTimeoutMs: 5000,
};

describe("MCP operational health", () => {
  it("combines API liveness with deployment and dependency readiness", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ status: "ok", service: "api" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/v1/system/operational-health")) {
        return new Response(
          JSON.stringify({
            status: "ready",
            runtime: { commitSha: "abc123" },
            dependencies: {
              database: { ready: true },
              worker: { online: true },
              queue: { queuedCount: 0 },
              provider: { provider: "deepseek", configured: true },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    });
    const health = createNocturneTools(config, fetchImpl).find(
      (tool) => tool.name === "nocturne_health",
    );

    expect(health).toBeDefined();
    await expect(health!.execute({})).resolves.toMatchObject({
      mcp: { status: "ok", service: "nocturne-mcp" },
      api: { status: "ok", service: "api" },
      operational: {
        status: "ready",
        runtime: { commitSha: "abc123" },
        dependencies: {
          worker: { online: true },
          provider: { provider: "deepseek", configured: true },
        },
      },
    });
    expect(fetchImpl.mock.calls.map(([input]) => String(input))).toEqual([
      "https://api.example.test/health",
      "https://api.example.test/v1/system/operational-health",
    ]);
  });
});
