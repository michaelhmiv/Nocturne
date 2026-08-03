import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MemoryMcpOAuthStore } from "../packages/auth/src/mcp-oauth-store.js";
import type { McpConfig } from "../apps/mcp/src/config.js";
import { OAuthService } from "../apps/mcp/src/oauth.js";

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

async function issueGrant(service: OAuthService) {
  const registered = service.registerClient({
    client_name: "ChatGPT",
    redirect_uris: ["https://chatgpt.com/aip/callback"],
    token_endpoint_auth_method: "none",
  });
  const verifier = "d".repeat(64);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const resource = `${config.publicBaseUrl}/mcp`;
  const authorization = new URLSearchParams({
    client_id: registered.client_id,
    redirect_uri: "https://chatgpt.com/aip/callback",
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "nocturne.read nocturne.write offline_access",
    resource,
    password: config.adminPassword!,
  });
  const approval = await service.approveAuthorization(authorization, "durable-user");
  expect(approval.ok).toBe(true);
  if (!approval.ok) throw new Error("authorization_failed");
  const code = new URL(approval.redirect).searchParams.get("code")!;
  const tokens = await service.exchangeToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      client_id: registered.client_id,
      redirect_uri: "https://chatgpt.com/aip/callback",
      code,
      code_verifier: verifier,
      resource,
    }),
  );
  return {
    clientId: registered.client_id,
    resource,
    verifier,
    code,
    accessToken: String(tokens.access_token),
    refreshToken: String(tokens.refresh_token),
  };
}

describe("durable MCP OAuth state", () => {
  it("uses PostgreSQL-safe aliases in token-consumption queries", () => {
    const source = readFileSync(
      new URL("../packages/auth/src/mcp-oauth-store.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toMatch(/\bAS\s+grant\b/i);
    expect(source.match(/\bAS\s+oauth_grant\b/g)).toHaveLength(2);
  });

  it("preserves replay prevention and revocation across service instances", async () => {
    const store = new MemoryMcpOAuthStore();
    const first = new OAuthService(config, store);
    const grant = await issueGrant(first);
    const principal = await first.authorizeBearer(`Bearer ${grant.accessToken}`);
    expect(principal.subject).toBe("durable-user");

    const restarted = new OAuthService(config, store);
    await expect(
      restarted.exchangeToken(
        new URLSearchParams({
          grant_type: "authorization_code",
          client_id: grant.clientId,
          redirect_uri: "https://chatgpt.com/aip/callback",
          code: grant.code,
          code_verifier: grant.verifier,
          resource: grant.resource,
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_grant" });

    const refreshed = await restarted.exchangeToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        client_id: grant.clientId,
        refresh_token: grant.refreshToken,
        resource: grant.resource,
      }),
    );
    await expect(
      first.exchangeToken(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: grant.clientId,
          refresh_token: grant.refreshToken,
          resource: grant.resource,
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_grant" });

    const grants = await store.listGrants("durable-user");
    expect(grants).toHaveLength(1);
    expect(await store.revokeGrant({ userId: "durable-user", grantId: grants[0]!.grantId })).toBe(
      true,
    );

    const afterRestart = new OAuthService(config, store);
    await expect(
      afterRestart.authorizeBearer(`Bearer ${String(refreshed.access_token)}`),
    ).rejects.toMatchObject({ code: "invalid_token" });
    await expect(
      afterRestart.exchangeToken(
        new URLSearchParams({
          grant_type: "refresh_token",
          client_id: grant.clientId,
          refresh_token: String(refreshed.refresh_token),
          resource: grant.resource,
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });
});
