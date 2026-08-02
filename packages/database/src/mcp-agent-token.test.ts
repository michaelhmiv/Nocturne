import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { authenticateMcpAgentToken } from "./mcp-agent-token.js";

const secret = "account-link-secret-with-at-least-thirty-two-characters";

function token(expOffsetSeconds = 300) {
  const body = Buffer.from(
    JSON.stringify({
      typ: "api_access",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + expOffsetSeconds,
      sub: "personal-user-id",
      aud: "nocturne-api",
      iss: "nocturne-mcp",
      scopes: ["character:read", "action:submit"],
      nonce: "test",
    }),
  ).toString("base64url");
  return `noct_mcp_${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
}

afterEach(() => {
  delete process.env.MCP_ACCOUNT_LINK_SECRET;
});

describe("MCP API agent authentication", () => {
  it("maps a valid signed MCP token onto the linked Nocturne user", () => {
    process.env.MCP_ACCOUNT_LINK_SECRET = secret;
    expect(authenticateMcpAgentToken(`Bearer ${token()}`)).toMatchObject({
      userId: "personal-user-id",
      label: "Nocturne MCP",
      boundCharacterId: null,
      scopes: ["character:read", "action:submit"],
    });
  });

  it("rejects expired or tampered tokens", () => {
    process.env.MCP_ACCOUNT_LINK_SECRET = secret;
    expect(authenticateMcpAgentToken(`Bearer ${token(-1)}`)).toBeNull();
    expect(authenticateMcpAgentToken(`Bearer ${token()}tampered`)).toBeNull();
  });
});
