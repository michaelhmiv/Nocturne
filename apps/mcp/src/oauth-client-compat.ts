import type { McpConfig } from "./config.js";
import { OAuthError, OAuthService } from "./oauth.js";

type PublicClientPayload = {
  typ: "client";
  iat: number;
  exp: number;
  redirectUris: string[];
  clientName: string;
  [key: string]: unknown;
};

type OAuthServiceInternals = {
  config: McpConfig;
  client(clientId: string): PublicClientPayload;
};

type OAuthServicePrototype = {
  client?: (this: OAuthServiceInternals, clientId: string) => PublicClientPayload;
};

const CLIENT_PREFIX = "nocturne_";
const MAX_CLIENT_LIFETIME_SECONDS = 60 * 60 * 24 * 366;
const MAX_CLOCK_SKEW_SECONDS = 300;
const CHATGPT_REDIRECT_HOSTS = new Set(["chatgpt.com", "openai.com"]);

let installed = false;

function invalidClient(): never {
  throw new OAuthError("invalid_client", "Unknown or expired OAuth client.", 401);
}

function trustedChatGptHost(host: string) {
  const normalized = host.toLowerCase();
  for (const allowed of CHATGPT_REDIRECT_HOSTS) {
    if (normalized === allowed || normalized.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

function decodeLegacyPublicClient(config: McpConfig, clientId: string): PublicClientPayload {
  if (!clientId.startsWith(CLIENT_PREFIX)) invalidClient();
  const token = clientId.slice(CLIENT_PREFIX.length);
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra || !/^[A-Za-z0-9_-]{43}$/.test(signature)) invalidClient();

  let candidate: unknown;
  try {
    candidate = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    invalidClient();
  }
  if (!candidate || typeof candidate !== "object") invalidClient();

  const payload = candidate as Partial<PublicClientPayload>;
  const now = Math.floor(Date.now() / 1000);
  if (
    payload.typ !== "client" ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp) ||
    payload.iat! > now + MAX_CLOCK_SKEW_SECONDS ||
    payload.exp! <= now ||
    payload.exp! <= payload.iat! ||
    payload.exp! - payload.iat! > MAX_CLIENT_LIFETIME_SECONDS
  ) {
    invalidClient();
  }
  if (
    typeof payload.clientName !== "string" ||
    !payload.clientName.trim() ||
    payload.clientName.length > 120 ||
    !/chatgpt|openai/i.test(payload.clientName)
  ) {
    invalidClient();
  }
  if (
    !Array.isArray(payload.redirectUris) ||
    payload.redirectUris.length === 0 ||
    payload.redirectUris.length > 10
  ) {
    invalidClient();
  }

  const redirectUris = payload.redirectUris.map((value) => {
    if (typeof value !== "string" || value.length > 2048) invalidClient();
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      invalidClient();
    }
    if (parsed.protocol !== "https:" || !trustedChatGptHost(parsed.hostname)) invalidClient();
    const configured = [...config.allowedRedirectHosts].some((allowed) => {
      const host = parsed.hostname.toLowerCase();
      return host === allowed || host.endsWith(`.${allowed}`);
    });
    if (!configured) invalidClient();
    return parsed.toString();
  });

  return {
    ...(payload as PublicClientPayload),
    clientName: payload.clientName.trim(),
    redirectUris,
  };
}

export function installOAuthClientKeyRotationCompatibility() {
  if (installed) return;
  const prototype = OAuthService.prototype as unknown as OAuthServicePrototype;
  const original = prototype.client;
  if (typeof original !== "function") {
    throw new Error("OAuth client verifier is unavailable.");
  }

  prototype.client = function (this: OAuthServiceInternals, clientId: string) {
    try {
      return original.call(this, clientId);
    } catch (error) {
      if (!(error instanceof OAuthError) || error.code !== "invalid_client") throw error;
      return decodeLegacyPublicClient(this.config, clientId);
    }
  };
  installed = true;
}
