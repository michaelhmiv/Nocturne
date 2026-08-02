import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_PREFIX = "noct_mcp_";
const nowSeconds = () => Math.floor(Date.now() / 1000);

type McpApiPayload = {
  typ: "api_access";
  iat: number;
  exp: number;
  sub: string;
  aud: "nocturne-api";
  iss: "nocturne-mcp";
  scopes: string[];
  nonce: string;
};

export type McpAgentIdentity = {
  tokenId: string;
  userId: string;
  label: string;
  boundCharacterId: null;
  scopes: string[];
};

export function authenticateMcpAgentToken(
  authorizationHeader: string | undefined,
): McpAgentIdentity | null {
  const secret = process.env.MCP_ACCOUNT_LINK_SECRET?.trim();
  if (!secret || !authorizationHeader) return null;
  const match = /^Bearer\s+(\S+)/i.exec(authorizationHeader.trim());
  const raw = match?.[1];
  if (!raw?.startsWith(TOKEN_PREFIX)) return null;
  const token = raw.slice(TOKEN_PREFIX.length);
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(body).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  let payload: McpApiPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as McpApiPayload;
  } catch {
    return null;
  }
  if (
    payload.typ !== "api_access" ||
    payload.aud !== "nocturne-api" ||
    payload.iss !== "nocturne-mcp" ||
    !Number.isInteger(payload.exp) ||
    payload.exp <= nowSeconds() ||
    typeof payload.sub !== "string" ||
    !payload.sub.trim() ||
    !Array.isArray(payload.scopes)
  ) {
    return null;
  }
  const scopes = payload.scopes.filter(
    (scope): scope is string => typeof scope === "string" && Boolean(scope.trim()),
  );
  if (!scopes.length) return null;
  return {
    tokenId: `mcp:${createHash("sha256").update(raw).digest("hex").slice(0, 24)}`,
    userId: payload.sub,
    label: "Nocturne MCP",
    boundCharacterId: null,
    scopes,
  };
}
