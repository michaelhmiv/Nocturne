export type ApiAuthMode = "guest" | "bearer";

export type McpConfig = {
  host: string;
  port: number;
  publicBaseUrl: string;
  apiBaseUrl: string;
  apiAuthMode: ApiAuthMode;
  apiBearerToken?: string;
  oauthSigningSecret: string;
  adminPassword: string;
  allowedRedirectHosts: Set<string>;
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  requestTimeoutMs: number;
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
  const apiBearerToken = env.NOCTURNE_API_TOKEN?.trim();
  if (apiAuthMode === "bearer" && !apiBearerToken) {
    throw new Error("NOCTURNE_API_TOKEN is required when NOCTURNE_API_AUTH_MODE=bearer.");
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
  const adminPassword = minimumLength(
    required(env, "MCP_ADMIN_PASSWORD"),
    "MCP_ADMIN_PASSWORD",
    16,
  );

  return {
    host: env.HOST?.trim() || "0.0.0.0",
    port: positiveInteger(env.PORT, 3002, "PORT"),
    publicBaseUrl: normalizedBaseUrl(required(env, "MCP_PUBLIC_BASE_URL"), "MCP_PUBLIC_BASE_URL"),
    apiBaseUrl: normalizedBaseUrl(required(env, "NOCTURNE_API_URL"), "NOCTURNE_API_URL"),
    apiAuthMode,
    apiBearerToken,
    oauthSigningSecret,
    adminPassword,
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
  };
}
