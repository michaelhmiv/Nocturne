import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

type ConsentTokenInput = {
  secret: string;
  userId: string;
  rawRequest: string;
  callback: string;
};

type ConsentTokenPayload = {
  typ: "mcp_consent";
  iat: number;
  exp: number;
  sub: string;
  requestHash: string;
  callbackHash: string;
  nonce: string;
};

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function signatureFor(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function createMcpConsentToken(
  input: ConsentTokenInput & { nowSeconds?: number; ttlSeconds?: number },
) {
  const issuedAt = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const payload: ConsentTokenPayload = {
    typ: "mcp_consent",
    iat: issuedAt,
    exp: issuedAt + (input.ttlSeconds ?? 600),
    sub: input.userId,
    requestHash: hash(input.rawRequest),
    callbackHash: hash(input.callback),
    nonce: randomBytes(18).toString("base64url"),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signatureFor(input.secret, body)}`;
}

export function verifyMcpConsentToken(
  input: ConsentTokenInput & { token: string; nowSeconds?: number },
) {
  try {
    const [body, suppliedSignature, extra] = input.token.split(".");
    if (!body || !suppliedSignature || extra) return false;

    const expectedSignature = signatureFor(input.secret, body);
    const supplied = Buffer.from(suppliedSignature, "base64url");
    const expected = Buffer.from(expectedSignature, "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;

    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<ConsentTokenPayload>;
    const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
    if (
      payload.typ !== "mcp_consent" ||
      typeof payload.iat !== "number" ||
      typeof payload.exp !== "number" ||
      payload.iat > now + 60 ||
      payload.exp < now ||
      payload.exp - payload.iat > 900 ||
      payload.sub !== input.userId ||
      payload.requestHash !== hash(input.rawRequest) ||
      payload.callbackHash !== hash(input.callback)
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
