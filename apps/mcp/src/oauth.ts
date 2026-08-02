import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { McpConfig } from "./config.js";

const base64url = (value: Buffer | string) => Buffer.from(value).toString("base64url");
const nowSeconds = () => Math.floor(Date.now() / 1000);

export type AuthorizedPrincipal = {
  subject: string;
  clientId: string;
  scopes: Set<string>;
};

type SignedPayload = {
  typ: "client" | "code" | "access" | "refresh";
  iat: number;
  exp: number;
  [key: string]: unknown;
};

type ClientPayload = SignedPayload & {
  typ: "client";
  redirectUris: string[];
  clientName: string;
};

type CodePayload = SignedPayload & {
  typ: "code";
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  resource: string;
  nonce: string;
};

type AccessPayload = SignedPayload & {
  typ: "access";
  sub: string;
  clientId: string;
  scope: string;
  aud: string;
};

type RefreshPayload = SignedPayload & {
  typ: "refresh";
  sub: string;
  clientId: string;
  scope: string;
  aud: string;
  nonce: string;
};

function sign(secret: string, payload: SignedPayload) {
  const body = base64url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verify<T extends SignedPayload>(secret: string, token: string, expectedType: T["typ"]): T {
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
  if (typed.typ !== expectedType || !Number.isInteger(typed.exp) || typed.exp <= nowSeconds()) {
    throw new Error("invalid_token");
  }
  return typed as T;
}

function constantTimeTextEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function html(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeScope(raw: string | undefined) {
  const requested = new Set(
    (raw || "nocturne.read nocturne.write offline_access").split(/\s+/).filter(Boolean),
  );
  const allowed = ["nocturne.read", "nocturne.write", "offline_access"];
  return allowed.filter((scope) => requested.has(scope)).join(" ") || "nocturne.read";
}

function normalizedUrl(value: string, errorCode: string, message: string) {
  try {
    return new URL(value).toString();
  } catch {
    throw new OAuthError(errorCode, message);
  }
}

export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

export class OAuthService {
  private readonly usedCodeHashes = new Set<string>();
  private readonly usedRefreshHashes = new Set<string>();
  private readonly resource: string;

  constructor(private readonly config: McpConfig) {
    this.resource = `${config.publicBaseUrl}/mcp`;
  }

  authorizationMetadata() {
    const base = this.config.publicBaseUrl;
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["nocturne.read", "nocturne.write", "offline_access"],
    };
  }

  protectedResourceMetadata() {
    return {
      resource: this.resource,
      resource_name: "Nocturne MCP",
      authorization_servers: [this.config.publicBaseUrl],
      bearer_methods_supported: ["header"],
      scopes_supported: ["nocturne.read", "nocturne.write"],
    };
  }

  private redirectHostAllowed(host: string) {
    const normalized = host.toLowerCase();
    for (const allowed of this.config.allowedRedirectHosts) {
      if (normalized === allowed || normalized.endsWith(`.${allowed}`)) return true;
    }
    return false;
  }

  registerClient(body: unknown) {
    if (!body || typeof body !== "object") {
      throw new OAuthError("invalid_client_metadata", "Client metadata must be a JSON object.");
    }
    const candidate = body as Record<string, unknown>;
    if (
      !Array.isArray(candidate.redirect_uris) ||
      candidate.redirect_uris.length === 0 ||
      candidate.redirect_uris.length > 10
    ) {
      throw new OAuthError("invalid_redirect_uri", "One to ten redirect URIs are required.");
    }
    if (
      candidate.token_endpoint_auth_method !== undefined &&
      candidate.token_endpoint_auth_method !== "none"
    ) {
      throw new OAuthError(
        "invalid_client_metadata",
        "This server supports public OAuth clients with token_endpoint_auth_method=none.",
      );
    }
    const redirectUris = candidate.redirect_uris.map((value) => {
      if (typeof value !== "string" || value.length > 2048) {
        throw new OAuthError("invalid_redirect_uri", "Redirect URIs must be valid strings.");
      }
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        throw new OAuthError("invalid_redirect_uri", "Redirect URI is not a valid URL.");
      }
      const host = parsed.hostname.toLowerCase();
      const local = host === "localhost" || host === "127.0.0.1";
      if ((!local && parsed.protocol !== "https:") || !this.redirectHostAllowed(host)) {
        throw new OAuthError("invalid_redirect_uri", `Redirect host ${host} is not allowed.`);
      }
      return parsed.toString();
    });
    const clientName =
      typeof candidate.client_name === "string" && candidate.client_name.trim()
        ? candidate.client_name.trim().slice(0, 120)
        : "ChatGPT MCP Client";
    const issuedAt = nowSeconds();
    const payload: ClientPayload = {
      typ: "client",
      iat: issuedAt,
      exp: issuedAt + 60 * 60 * 24 * 365,
      redirectUris,
      clientName,
    };
    return {
      client_id: `nocturne_${sign(this.config.oauthSigningSecret, payload)}`,
      client_id_issued_at: issuedAt,
      client_secret_expires_at: 0,
      redirect_uris: redirectUris,
      client_name: clientName,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  private client(clientId: string) {
    if (!clientId.startsWith("nocturne_")) {
      throw new OAuthError("invalid_client", "Unknown OAuth client.", 401);
    }
    try {
      return verify<ClientPayload>(
        this.config.oauthSigningSecret,
        clientId.slice("nocturne_".length),
        "client",
      );
    } catch {
      throw new OAuthError("invalid_client", "Unknown or expired OAuth client.", 401);
    }
  }

  private requestedResource(input: URLSearchParams, fallback = this.resource) {
    const resource = input.get("resource") || fallback;
    const normalized = normalizedUrl(resource, "invalid_target", "OAuth resource is invalid.");
    if (normalized !== this.resource) {
      throw new OAuthError("invalid_target", "OAuth resource does not identify this MCP server.");
    }
    return normalized;
  }

  private authorizationInput(input: URLSearchParams) {
    const clientId = input.get("client_id") || "";
    const redirectUri = input.get("redirect_uri") || "";
    const responseType = input.get("response_type") || "";
    const codeChallenge = input.get("code_challenge") || "";
    const codeChallengeMethod = input.get("code_challenge_method") || "";
    const state = input.get("state") || "";
    const scope = normalizeScope(input.get("scope") || undefined);
    const resource = this.requestedResource(input);
    const client = this.client(clientId);
    if (responseType !== "code") {
      throw new OAuthError(
        "unsupported_response_type",
        "Only authorization code flow is supported.",
      );
    }
    const normalizedRedirect = normalizedUrl(
      redirectUri,
      "invalid_redirect_uri",
      "The redirect URI is invalid.",
    );
    if (!client.redirectUris.includes(normalizedRedirect)) {
      throw new OAuthError(
        "invalid_redirect_uri",
        "The redirect URI is not registered for this client.",
      );
    }
    if (codeChallengeMethod !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
      throw new OAuthError("invalid_request", "PKCE with S256 is required.");
    }
    return {
      clientId,
      redirectUri: normalizedRedirect,
      state,
      scope,
      resource,
      codeChallenge,
      client,
    };
  }

  renderAuthorizationPage(input: URLSearchParams, errorMessage?: string) {
    const authorization = this.authorizationInput(input);
    const hidden = [...input.entries()]
      .filter(([key]) => key !== "password")
      .map(
        ([key, value]) =>
          `<input type="hidden" name="${html(key)}" value="${html(value)}">`,
      )
      .join("");
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize Nocturne MCP</title><style>
body{font-family:system-ui,-apple-system,sans-serif;background:#101014;color:#ececf1;margin:0;min-height:100vh;display:grid;place-items:center}
main{width:min(520px,calc(100% - 32px));background:#18181f;border:1px solid #343440;border-radius:16px;padding:28px;box-shadow:0 18px 60px #0008}
h1{margin:0 0 8px;font-size:24px}p{line-height:1.5;color:#b7b7c4}.scope{background:#111117;border-radius:10px;padding:12px;margin:18px 0;color:#d8d8e0}
label{display:block;font-weight:650;margin:18px 0 8px}input[type=password]{box-sizing:border-box;width:100%;padding:12px;border-radius:10px;border:1px solid #464655;background:#0f0f14;color:white}
button{width:100%;padding:12px;border:0;border-radius:10px;background:#e8e8ef;color:#111;font-weight:750;cursor:pointer}.error{color:#ff9b9b}
small{display:block;margin-top:14px;color:#858593}
</style></head><body><main>
<h1>Authorize Nocturne MCP</h1>
<p><strong>${html(authorization.client.clientName)}</strong> is requesting access to the Nocturne testing interface.</p>
<div class="scope">Requested permissions: ${html(authorization.scope)}</div>
${errorMessage ? `<p class="error">${html(errorMessage)}</p>` : ""}
<form method="post" action="/oauth/authorize">${hidden}
<label for="password">Nocturne MCP password</label><input id="password" name="password" type="password" required autofocus autocomplete="current-password">
<button type="submit">Authorize</button></form>
<small>This grants access to the configured Nocturne account. Write tools can change in-game state.</small>
</main></body></html>`;
  }

  approveAuthorization(input: URLSearchParams) {
    const password = input.get("password") || "";
    const authorization = this.authorizationInput(input);
    if (!constantTimeTextEqual(password, this.config.adminPassword)) {
      return {
        ok: false as const,
        html: this.renderAuthorizationPage(input, "Incorrect password."),
      };
    }
    const issuedAt = nowSeconds();
    const code = sign(this.config.oauthSigningSecret, {
      typ: "code",
      iat: issuedAt,
      exp: issuedAt + 300,
      clientId: authorization.clientId,
      redirectUri: authorization.redirectUri,
      codeChallenge: authorization.codeChallenge,
      scope: authorization.scope,
      resource: authorization.resource,
      nonce: randomBytes(18).toString("base64url"),
    } satisfies CodePayload);
    const redirect = new URL(authorization.redirectUri);
    redirect.searchParams.set("code", code);
    if (authorization.state) redirect.searchParams.set("state", authorization.state);
    return { ok: true as const, redirect: redirect.toString() };
  }

  exchangeToken(input: URLSearchParams) {
    const grantType = input.get("grant_type") || "";
    const clientId = input.get("client_id") || "";
    this.client(clientId);
    if (grantType === "authorization_code") {
      const code = input.get("code") || "";
      const redirectUri = normalizedUrl(
        input.get("redirect_uri") || "",
        "invalid_grant",
        "Redirect URI is invalid.",
      );
      const verifier = input.get("code_verifier") || "";
      let payload: CodePayload;
      try {
        payload = verify<CodePayload>(this.config.oauthSigningSecret, code, "code");
      } catch {
        throw new OAuthError("invalid_grant", "Authorization code is invalid or expired.");
      }
      const resource = this.requestedResource(input, payload.resource);
      const codeHash = createHash("sha256").update(code).digest("hex");
      if (this.usedCodeHashes.has(codeHash)) {
        throw new OAuthError("invalid_grant", "Authorization code was already used.");
      }
      if (
        payload.clientId !== clientId ||
        payload.redirectUri !== redirectUri ||
        payload.resource !== resource
      ) {
        throw new OAuthError(
          "invalid_grant",
          "Authorization code does not match this client, redirect URI, or resource.",
        );
      }
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      if (!verifier || !constantTimeTextEqual(challenge, payload.codeChallenge)) {
        throw new OAuthError("invalid_grant", "PKCE verification failed.");
      }
      this.usedCodeHashes.add(codeHash);
      if (this.usedCodeHashes.size > 10_000) this.usedCodeHashes.clear();
      return this.issueTokens(clientId, payload.scope, resource);
    }
    if (grantType === "refresh_token") {
      const raw = input.get("refresh_token") || "";
      let payload: RefreshPayload;
      try {
        payload = verify<RefreshPayload>(this.config.oauthSigningSecret, raw, "refresh");
      } catch {
        throw new OAuthError("invalid_grant", "Refresh token is invalid or expired.");
      }
      const resource = this.requestedResource(input, payload.aud);
      if (payload.clientId !== clientId || payload.aud !== resource) {
        throw new OAuthError(
          "invalid_grant",
          "Refresh token does not belong to this client or resource.",
        );
      }
      const refreshHash = createHash("sha256").update(raw).digest("hex");
      if (this.usedRefreshHashes.has(refreshHash)) {
        throw new OAuthError("invalid_grant", "Refresh token was already rotated.");
      }
      this.usedRefreshHashes.add(refreshHash);
      if (this.usedRefreshHashes.size > 10_000) this.usedRefreshHashes.clear();
      return this.issueTokens(clientId, payload.scope, resource);
    }
    throw new OAuthError(
      "unsupported_grant_type",
      "Supported grants are authorization_code and refresh_token.",
    );
  }

  private issueTokens(clientId: string, scope: string, resource: string) {
    const issuedAt = nowSeconds();
    const subject = "nocturne-mcp-tester";
    const accessToken = sign(this.config.oauthSigningSecret, {
      typ: "access",
      iat: issuedAt,
      exp: issuedAt + this.config.accessTokenTtlSeconds,
      sub: subject,
      clientId,
      scope,
      aud: resource,
    } satisfies AccessPayload);
    const response: Record<string, unknown> = {
      token_type: "Bearer",
      access_token: accessToken,
      expires_in: this.config.accessTokenTtlSeconds,
      scope,
    };
    if (scope.split(/\s+/).includes("offline_access")) {
      response.refresh_token = sign(this.config.oauthSigningSecret, {
        typ: "refresh",
        iat: issuedAt,
        exp: issuedAt + this.config.refreshTokenTtlSeconds,
        sub: subject,
        clientId,
        scope,
        aud: resource,
        nonce: randomBytes(18).toString("base64url"),
      } satisfies RefreshPayload);
    }
    return response;
  }

  authorizeBearer(header: string | undefined): AuthorizedPrincipal {
    const match = header?.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) {
      throw new OAuthError("invalid_token", "A valid bearer token is required.", 401);
    }
    let payload: AccessPayload;
    try {
      payload = verify<AccessPayload>(this.config.oauthSigningSecret, match[1], "access");
    } catch {
      throw new OAuthError("invalid_token", "Bearer token is invalid or expired.", 401);
    }
    if (payload.aud !== this.resource) {
      throw new OAuthError("invalid_token", "Bearer token was not issued for this MCP server.", 401);
    }
    return {
      subject: payload.sub,
      clientId: payload.clientId,
      scopes: new Set(payload.scope.split(/\s+/).filter(Boolean)),
    };
  }
}
