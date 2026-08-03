import { describe, expect, it } from "vitest";
import { createMcpConsentToken, verifyMcpConsentToken } from "./mcp-consent-token";

const input = {
  secret: "test-secret-that-is-long-enough",
  userId: "user-123",
  rawRequest: JSON.stringify({ client_id: "chatgpt", code_challenge: "abc" }),
  callback: "https://nocturnemcp-production.up.railway.app/oauth/account-callback",
};

describe("MCP consent tokens", () => {
  it("accepts a valid token regardless of browser origin behavior", () => {
    const token = createMcpConsentToken({ ...input, nowSeconds: 1_000 });

    expect(verifyMcpConsentToken({ ...input, token, nowSeconds: 1_001 })).toBe(true);
  });

  it("binds consent to the user, OAuth request, and callback", () => {
    const token = createMcpConsentToken({ ...input, nowSeconds: 1_000 });

    expect(
      verifyMcpConsentToken({ ...input, userId: "other-user", token, nowSeconds: 1_001 }),
    ).toBe(false);
    expect(
      verifyMcpConsentToken({ ...input, rawRequest: "other-request", token, nowSeconds: 1_001 }),
    ).toBe(false);
    expect(
      verifyMcpConsentToken({
        ...input,
        callback: "https://nocturnemcp-production.up.railway.app/oauth/account-callback?other=1",
        token,
        nowSeconds: 1_001,
      }),
    ).toBe(false);
  });

  it("rejects expired and tampered tokens", () => {
    const token = createMcpConsentToken({ ...input, nowSeconds: 1_000, ttlSeconds: 10 });

    expect(verifyMcpConsentToken({ ...input, token, nowSeconds: 1_011 })).toBe(false);
    expect(
      verifyMcpConsentToken({ ...input, token: `${token.slice(0, -1)}x`, nowSeconds: 1_001 }),
    ).toBe(false);
  });
});
