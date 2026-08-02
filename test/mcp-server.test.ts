import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpConfig } from "../apps/mcp/src/config.js";
import { createMcpServer } from "../apps/mcp/src/server.js";

const servers: ReturnType<typeof createMcpServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

async function start(fetchImpl: typeof fetch) {
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
  const server = createMcpServer(config, fetchImpl);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}` };
}

async function authorize(baseUrl: string) {
  const registered = await fetch(`${baseUrl}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "ChatGPT",
      redirect_uris: ["https://chatgpt.com/aip/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  }).then((response) => response.json() as Promise<{ client_id: string }>);
  const verifier = "a".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const resource = "https://mcp.example.test/mcp";
  const approval = await fetch(`${baseUrl}/oauth/authorize`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: registered.client_id,
      redirect_uri: "https://chatgpt.com/aip/callback",
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      scope: "nocturne.read nocturne.write offline_access",
      state: "state-1",
      resource,
      password: "correct horse battery staple",
    }),
    redirect: "manual",
  });
  expect(approval.status).toBe(302);
  const callback = new URL(approval.headers.get("location")!);
  expect(callback.searchParams.get("state")).toBe("state-1");
  const tokens = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: registered.client_id,
      redirect_uri: "https://chatgpt.com/aip/callback",
      code: callback.searchParams.get("code")!,
      code_verifier: verifier,
      resource,
    }),
  }).then(
    (response) => response.json() as Promise<{ access_token: string; refresh_token: string }>,
  );
  return { ...tokens, clientId: registered.client_id, resource };
}

async function rpc(baseUrl: string, accessToken: string, body: unknown) {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
}

describe("Nocturne MCP service", () => {
  it("publishes OAuth metadata, rotates refresh tokens, and exposes tools", async () => {
    const apiFetch = vi.fn<typeof fetch>(async (input) => {
      if (String(input).endsWith("/health")) {
        return new Response(JSON.stringify({ status: "ok", service: "api" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: "not_found" }), { status: 404 });
    });
    const { baseUrl } = await start(apiFetch);
    const metadata = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`).then(
      (response) => response.json() as Promise<Record<string, unknown>>,
    );
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    const tokens = await authorize(baseUrl);

    const refreshed = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: tokens.clientId,
        refresh_token: tokens.refresh_token,
        resource: tokens.resource,
      }),
    });
    expect(refreshed.status).toBe(200);
    expect(await refreshed.json()).toMatchObject({ token_type: "Bearer" });
    const replayedRefresh = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: tokens.clientId,
        refresh_token: tokens.refresh_token,
        resource: tokens.resource,
      }),
    });
    expect(replayedRefresh.status).toBe(400);

    const initialized = await rpc(baseUrl, tokens.access_token, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", clientInfo: { name: "test", version: "1" } },
    });
    expect(initialized.status).toBe(200);
    expect(await initialized.json()).toMatchObject({
      result: { protocolVersion: "2025-06-18", serverInfo: { name: "nocturne-mcp" } },
    });

    const listed = await rpc(baseUrl, tokens.access_token, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    }).then((response) => response.json() as Promise<any>);
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toContain(
      "submit_action",
    );
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toContain(
      "get_operator_dashboard",
    );

    const health = await rpc(baseUrl, tokens.access_token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "nocturne_health", arguments: {} },
    }).then((response) => response.json() as Promise<any>);
    expect(health.result.structuredContent.api).toEqual({ status: "ok", service: "api" });
    const requestInit = apiFetch.mock.calls[0]![1] as RequestInit;
    expect(new Headers(requestInit.headers).get("x-nocturne-guest-mode")).toBe("1");
  });

  it("submits only natural-language text through the persistent-world endpoint", async () => {
    const apiFetch = vi.fn<typeof fetch>(async (_input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(
        JSON.stringify({ state: "waiting", requestId: "request-1", received: body }),
        { status: 202, headers: { "content-type": "application/json" } },
      );
    });
    const { baseUrl } = await start(apiFetch);
    const tokens = await authorize(baseUrl);
    const result = await rpc(baseUrl, tokens.access_token, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "submit_action",
        arguments: { text: "Travel to town hall and fist fight the mayor." },
      },
    }).then((response) => response.json() as Promise<any>);
    expect(result.result.isError).not.toBe(true);
    expect(result.result.structuredContent.received).toEqual({
      command: "Travel to town hall and fist fight the mayor.",
    });
    expect(String(apiFetch.mock.calls[0]![0])).toBe(
      "https://api.example.test/v1/persistent-world/actions",
    );
    const headers = new Headers((apiFetch.mock.calls[0]![1] as RequestInit).headers);
    expect(headers.get("idempotency-key")).toMatch(/^mcp-action-/);
    expect(headers.get("x-nocturne-trace-id")).toMatch(/^mcp-/);
  });

  it("rejects unauthenticated MCP calls with protected-resource discovery", async () => {
    const { baseUrl } = await start(vi.fn<typeof fetch>());
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("oauth-protected-resource/mcp");
  });
});
