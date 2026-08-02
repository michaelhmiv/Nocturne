import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  oauthRequestHash,
  signUpstreamApiToken,
  verifyAccountAssertion,
} from "./mcp-account-auth.js";

const secret = "account-link-secret-with-at-least-thirty-two-characters";

function assertion(userId: string, audience: string, rawRequest: string) {
  const body = Buffer.from(
    JSON.stringify({
      typ: "account_assertion",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      sub: userId,
      aud: audience,
      requestHash: createHash("sha256").update(rawRequest).digest("hex"),
      nonce: "test",
    }),
  ).toString("base64url");
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

describe("MCP account linking", () => {
  it("binds a signed assertion to the exact OAuth request", () => {
    const rawRequest = "client_id=test&scope=nocturne.read+nocturne.write";
    const token = assertion("user-123", "https://mcp.example", rawRequest);
    expect(
      verifyAccountAssertion({
        secret,
        assertion: token,
        audience: "https://mcp.example",
        rawRequest,
      }),
    ).toEqual({ userId: "user-123" });
    expect(() =>
      verifyAccountAssertion({
        secret,
        assertion: token,
        audience: "https://mcp.example",
        rawRequest: `${rawRequest}&state=changed`,
      }),
    ).toThrow("invalid_account_assertion");
  });

  it("creates API tokens for the linked user without exposing credentials", () => {
    const token = signUpstreamApiToken({ secret, userId: "user-123", writable: true });
    expect(token).toMatch(/^noct_mcp_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(
      Buffer.from(token.slice("noct_mcp_".length).split(".")[0]!, "base64url").toString(),
    ).toContain('"sub":"user-123"');
    expect(oauthRequestHash("abc")).toHaveLength(64);
  });
});
