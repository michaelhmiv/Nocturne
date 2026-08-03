import { betterAuth } from "better-auth";
import { fromNodeHeaders } from "better-auth/node";
import { Pool } from "pg";

export * from "./mcp-oauth-store.js";

export interface NocturneAuthConfig {
  databaseUrl: string;
  secret: string;
  baseUrl: string;
  trustedOrigins: string[];
}

function databaseUrlWithAuthSchema(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.set("options", "-c search_path=auth,public");
  return parsed.toString();
}

export function createNocturneAuth(config: NocturneAuthConfig) {
  const pool = new Pool({
    connectionString: databaseUrlWithAuthSchema(config.databaseUrl),
    max: 10,
  });

  const auth = betterAuth({
    database: pool,
    secret: config.secret,
    baseURL: config.baseUrl,
    trustedOrigins: config.trustedOrigins,
    emailAndPassword: {
      enabled: true,
    },
    session: {
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60,
      },
    },
  });

  return Object.assign(auth, { close: () => pool.end() });
}

let singleton: ReturnType<typeof createNocturneAuth> | undefined;

export function getAuthFromEnv() {
  if (singleton) return singleton;

  const databaseUrl = process.env.DATABASE_URL;
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseUrl = process.env.BETTER_AUTH_URL;

  if (!databaseUrl || !secret || !baseUrl) {
    throw new Error("DATABASE_URL, BETTER_AUTH_SECRET, and BETTER_AUTH_URL are required.");
  }

  singleton = createNocturneAuth({
    databaseUrl,
    secret,
    baseUrl,
    trustedOrigins: (process.env.BETTER_AUTH_TRUSTED_ORIGINS || baseUrl)
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  });

  return singleton;
}

export function getSessionFromNodeHeaders(headers: Record<string, string | string[] | undefined>) {
  return getAuthFromEnv().api.getSession({ headers: fromNodeHeaders(headers) });
}

export async function closeAuthFromEnv(): Promise<void> {
  if (!singleton) return;
  await singleton.close();
  singleton = undefined;
}
