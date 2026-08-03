import { describe, expect, it } from "vitest";
import {
  expectedMcpAuthorizationOrigin,
  isValidMcpAuthorizationOrigin,
} from "./mcp-authorization-origin";

describe("MCP authorization origin validation", () => {
  it("uses the configured public web origin behind a reverse proxy", () => {
    expect(
      expectedMcpAuthorizationOrigin({
        requestUrl: "http://web.railway.internal/api/mcp/authorize",
        configuredPublicUrl: "https://nocturneweb-production.up.railway.app",
      }),
    ).toBe("https://nocturneweb-production.up.railway.app");

    expect(
      isValidMcpAuthorizationOrigin({
        requestOrigin: "https://nocturneweb-production.up.railway.app",
        requestUrl: "http://web.railway.internal/api/mcp/authorize",
        configuredPublicUrl: "https://nocturneweb-production.up.railway.app",
      }),
    ).toBe(true);
  });

  it("rejects a different browser origin", () => {
    expect(
      isValidMcpAuthorizationOrigin({
        requestOrigin: "https://attacker.example",
        requestUrl: "http://web.railway.internal/api/mcp/authorize",
        configuredPublicUrl: "https://nocturneweb-production.up.railway.app",
      }),
    ).toBe(false);
  });

  it("falls back to the request URL when no public URL is configured", () => {
    expect(
      isValidMcpAuthorizationOrigin({
        requestOrigin: "http://localhost:3000",
        requestUrl: "http://localhost:3000/api/mcp/authorize",
      }),
    ).toBe(true);
  });
});
