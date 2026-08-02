import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const nowSeconds = () => Math.floor(Date.now() / 1000);
const API_TOKEN_PREFIX = "noct_mcp_";

type SignedPayload = {
  typ: "account_assertion" | "api_access";
  iat: number;
  exp: number;
  [key: string]: unknown;
};

type AccountAssertionPayload = SignedPayload & {
  typ: "account_assertion";
  sub: string;
  aud: string;
  requestHash: string;
  nonce: string;
};

type ApiAccessPayload = SignedPayload & {
  typ: "api_access";
  sub: string;
  aud: "nocturne-api";
  iss: "nocturne-mcp";
  scopes: string[];
  nonce: string;
};

function sign(secret: string, payload: SignedPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verify<T extends SignedPayload>(secret: string, token: string, type: T["typ"]): T {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) throw new Error("invalid_token");
  const expected = createHmac("sha256", secret).update(body).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new Error("invalid_token");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new Error("invalid_token");
  }
  if (!payload || typeof payload !== "object") throw new Error("invalid_token");
  const typed = payload as SignedPayload;
  if (typed.typ !== type || !Number.isInteger(typed.exp) || typed.exp <= nowSeconds()) {
    throw new Error("invalid_token");
  }
  return typed as T;
}

export function oauthRequestHash(rawRequest: string) {
  return createHash("sha256").update(rawRequest).digest("hex");
}

export function verifyAccountAssertion(input: {
  secret: string;
  assertion: string;
  audience: string;
  rawRequest: string;
}) {
  const payload = verify<AccountAssertionPayload>(
    input.secret,
    input.assertion,
    "account_assertion",
  );
  if (
    payload.aud !== input.audience ||
    payload.requestHash !== oauthRequestHash(input.rawRequest) ||
    typeof payload.sub !== "string" ||
    !payload.sub.trim()
  ) {
    throw new Error("invalid_account_assertion");
  }
  return { userId: payload.sub };
}

export function signUpstreamApiToken(input: {
  secret: string;
  userId: string;
  writable: boolean;
  ttlSeconds?: number;
}) {
  const issuedAt = nowSeconds();
  const scopes = input.writable
    ? [
        "character:read",
        "character:write",
        "action:submit",
        "market:read",
        "market:trade",
        "vehicle:read",
        "vehicle:claim",
      ]
    : ["character:read", "market:read", "vehicle:read"];
  return `${API_TOKEN_PREFIX}${sign(input.secret, {
    typ: "api_access",
    iat: issuedAt,
    exp: issuedAt + (input.ttlSeconds ?? 60 * 60 * 24 * 30),
    sub: input.userId,
    aud: "nocturne-api",
    iss: "nocturne-mcp",
    scopes,
    nonce: randomBytes(18).toString("base64url"),
  } satisfies ApiAccessPayload)}`;
}
