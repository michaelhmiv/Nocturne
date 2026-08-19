export type ApiAuthMode = "guest" | "bearer";
export type McpMode = "player" | "diagnostic";

export type McpConfig = {
  host: string;
  port: number;
  publicBaseUrl: string;
  webBaseUrl?: string;
  apiBaseUrl: string;
  apiAuthMode: ApiAuthMode;
  apiBearerToken?: string;
  databaseUrl?: string;
  oauthSigningSecret: string;
  adminPassword?: string;
  accountLinkSecret?: string;
  allowedRedirectHosts: Set<string>;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  requestTimeoutMs: number;
  mode: McpMode;
};

function required(env: Record<string, string | undefined>, key: string) {
  const value = env[key]?.trim();
  if (!value) throw new Error(`${key} is required.`);
  return value;
}

function minimumLength(value: string, key: string, length: number) {
  if (value.length < length) throw new Error(`${key} must be at least ${length} characters.`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number, key: string) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer.`);
  }
  return parsed;
}

function normalizedBaseUrl(value: string, key: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${key} must use http or https.`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (key === "MCP_PUBLIC_BASE_URL" && !local && url.protocol !== "https:") {
    throw new Error("MCP_PUBLIC_BASE_URL must use https outside local development.");
  }
  return url.toString().replace(/\/$/, "");
}

export function loadMcpConfig(env: Record<string, string | undefined> = process.env): McpConfig {
  const apiAuthMode = (env.NOCTURNE_API_AUTH_MODE || "guest").trim().toLowerCase();
  if (apiAuthMode !== "guest" && apiAuthMode !== "bearer") {
    throw new Error("NOCTURNE_API_AUTH_MODE must be guest or bearer.");
  }
  const mode = (env.MCP_MODE || "diagnostic").trim().toLowerCase();
  if (mode !== "player" && mode !== "diagnostic") {
    throw new Error("MCP_MODE must be player or diagnostic.");
  }
  const apiBearerToken = env.NOCTURNE_API_TOKEN?.trim() || undefined;
  const accountLinkSecret = env.MCP_ACCOUNT_LINK_SECRET?.trim()
    ? minimumLength(env.MCP_ACCOUNT_LINK_SECRET.trim(), "MCP_ACCOUNT_LINK_SECRET", 32)
    : undefined;
  const webBaseUrl = env.NOCTURNE_WEB_URL?.trim()
    ? normalizedBaseUrl(env.NOCTURNE_WEB_URL.trim(), "NOCTURNE_WEB_URL")
    : undefined;
  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  if (Boolean(accountLinkSecret) !== Boolean(webBaseUrl)) {
    throw new Error(
      "MCP_ACCOUNT_LINK_SECRET and NOCTURNE_WEB_URL must either both be configured or both be omitted.",
    );
  }
  if (accountLinkSecret && !databaseUrl) {
    throw new Error("DATABASE_URL is required when Nocturne account linking is configured.");
  }
  if (apiAuthMode === "bearer" && !apiBearerToken && !accountLinkSecret) {
    throw new Error(
      "NOCTURNE_API_TOKEN is required for bearer mode unless Nocturne account linking is configured.",
    );
  }

  const allowedRedirectHosts = new Set(
    (env.MCP_ALLOWED_REDIRECT_HOSTS || "chatgpt.com,openai.com,localhost,127.0.0.1")
      .split(",")
      .map((host) => host.trim().toLowerCase().replace(/^\./, ""))
      .filter(Boolean),
  );
  const oauthSigningSecret = minimumLength(
    required(env, "MCP_OAUTH_SIGNING_SECRET"),
    "MCP_OAUTH_SIGNING_SECRET",
    32,
  );
  const adminPassword = env.MCP_ADMIN_PASSWORD?.trim()
    ? minimumLength(env.MCP_ADMIN_PASSWORD.trim(), "MCP_ADMIN_PASSWORD", 16)
    : undefined;
  if (!accountLinkSecret && !adminPassword) {
    throw new Error(
      "MCP_ADMIN_PASSWORD is required when Nocturne account linking is not configured.",
    );
  }

  return {
    host: env.HOST?.trim() || "0.0.0.0",
    port: positiveInteger(env.PORT, 3002, "PORT"),
    publicBaseUrl: normalizedBaseUrl(required(env, "MCP_PUBLIC_BASE_URL"), "MCP_PUBLIC_BASE_URL"),
    webBaseUrl,
    apiBaseUrl: normalizedBaseUrl(required(env, "NOCTURNE_API_URL"), "NOCTURNE_API_URL"),
    apiAuthMode,
    apiBearerToken,
    databaseUrl,
    oauthSigningSecret,
    adminPassword,
    accountLinkSecret,
    allowedRedirectHosts,
    accessTokenTtlSeconds: positiveInteger(
      env.MCP_ACCESS_TOKEN_TTL_SECONDS,
      3600,
      "MCP_ACCESS_TOKEN_TTL_SECONDS",
    ),
    refreshTokenTtlSeconds: positiveInteger(
      env.MCP_REFRESH_TOKEN_TTL_SECONDS,
      60 * 60 * 24 * 30,
      "MCP_REFRESH_TOKEN_TTL_SECONDS",
    ),
    requestTimeoutMs: positiveInteger(
      env.MCP_REQUEST_TIMEOUT_MS,
      120_000,
      "MCP_REQUEST_TIMEOUT_MS",
    ),
    mode,
  };
}
