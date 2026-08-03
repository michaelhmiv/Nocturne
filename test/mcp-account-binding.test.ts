import { createHash, createHmac, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpConfig } from "../apps/mcp/src/config.js";
import { createMcpServer } from "../apps/mcp/src/server.js";

const servers: ReturnType<typeof createMcpServer>[] = [];
const publicBaseUrl = "https://mcp.example.test";
const accountLinkSecret = "account-link-secret-account-link-secret";

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
    publicBaseUrl,
    webBaseUrl: "https://web.example.test",
    apiBaseUrl: "https://api.example.test",
    apiAuthMode: "guest",
    oauthSigningSecret: "test-signing-secret-test-signing-secret",
    accountLinkSecret,
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

function signAccountAssertion(userId: string, rawRequest: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({
      typ: "account_assertion",
      iat: issuedAt,
      exp: issuedAt + 300,
      sub: userId,
      aud: publicBaseUrl,
      requestHash: createHash("sha256").update(rawRequest).digest("hex"),
      nonce: randomBytes(18).toString("base64url"),
    }),
  ).toString("base64url");
  const signature = createHmac("sha256", accountLinkSecret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

async function authorizeAccount(baseUrl: string, userId: string) {
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
  const verifier = "v".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const resource = `${publicBaseUrl}/mcp`;
  const authorization = new URLSearchParams({
    client_id: registered.client_id,
    redirect_uri: "https://chatgpt.com/aip/callback",
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "nocturne.read nocturne.write offline_access",
    state: `state-${userId}`,
    resource,
  });
  const rawRequest = authorization.toString();
  const callback = new URL(`${baseUrl}/oauth/account-callback`);
  callback.searchParams.set("oauth_request", Buffer.from(rawRequest).toString("base64url"));
  callback.searchParams.set("assertion", signAccountAssertion(userId, rawRequest));
  const approval = await fetch(callback, { redirect: "manual" });
  expect(approval.status).toBe(302);
  const redirect = new URL(approval.headers.get("location")!);

  const tokens = await fetch(`${baseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: registered.client_id,
      redirect_uri: "https://chatgpt.com/aip/callback",
      code: redirect.searchParams.get("code")!,
      code_verifier: verifier,
      resource,
    }),
  }).then(
    (response) => response.json() as Promise<{ access_token: string; refresh_token: string }>,
  );
  return { ...tokens, clientId: registered.client_id, resource };
}

async function callHealth(baseUrl: string, accessToken: string) {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "nocturne_health", arguments: {} },
    }),
  });
}

function upstreamSubject(header: string | null) {
  const raw = header?.replace(/^Bearer\s+/i, "") || "";
  expect(raw.startsWith("noct_mcp_")).toBe(true);
  const [body] = raw.slice("noct_mcp_".length).split(".");
  return JSON.parse(Buffer.from(body!, "base64url").toString("utf8")) as {
    sub: string;
    scopes: string[];
  };
}

type UpstreamRequest = { url: string; authorization: string };

describe("MCP Nocturne account binding", () => {
  it("keeps account identity isolated across grants and refreshes", async () => {
    const upstreamRequests: UpstreamRequest[] = [];
    const apiFetch = vi.fn<typeof fetch>(async (input, init) => {
      upstreamRequests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization") || "",
      });
      return new Response(JSON.stringify({ status: "ok", service: "api" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const { baseUrl } = await start(apiFetch);
    const accountA = await authorizeAccount(baseUrl, "user-account-a");
    const accountB = await authorizeAccount(baseUrl, "user-account-b");

    expect((await callHealth(baseUrl, accountA.access_token)).status).toBe(200);
    expect((await callHealth(baseUrl, accountB.access_token)).status).toBe(200);

    const livenessSubjects = upstreamRequests
      .filter((request) => request.url.endsWith("/health"))
      .map((request) => upstreamSubject(request.authorization));
    const operationalSubjects = upstreamRequests
      .filter((request) => request.url.endsWith("/v1/system/operational-health"))
      .map((request) => upstreamSubject(request.authorization));

    expect(livenessSubjects.map((subject) => subject.sub)).toEqual([
      "user-account-a",
      "user-account-b",
    ]);
    expect(operationalSubjects.map((subject) => subject.sub)).toEqual([
      "user-account-a",
      "user-account-b",
    ]);
    expect(livenessSubjects[0]!.scopes).toContain("action:submit");

    const refreshed = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: accountA.clientId,
        refresh_token: accountA.refresh_token,
        resource: accountA.resource,
      }),
    }).then((response) => response.json() as Promise<{ access_token: string }>);
    expect((await callHealth(baseUrl, refreshed.access_token)).status).toBe(200);

    const refreshedLiveness = upstreamRequests
      .filter((request) => request.url.endsWith("/health"))
      .map((request) => upstreamSubject(request.authorization));
    const refreshedOperational = upstreamRequests
      .filter((request) => request.url.endsWith("/v1/system/operational-health"))
      .map((request) => upstreamSubject(request.authorization));
    expect(refreshedLiveness.map((subject) => subject.sub)).toEqual([
      "user-account-a",
      "user-account-b",
      "user-account-a",
    ]);
    expect(refreshedOperational.map((subject) => subject.sub)).toEqual([
      "user-account-a",
      "user-account-b",
      "user-account-a",
    ]);
  });
});
