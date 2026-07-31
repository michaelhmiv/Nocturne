import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { createDatabase } from "./index.js";

export class AgentStoreError extends Error {
  constructor(
    readonly code: "not_found" | "forbidden" | "invalid_token" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "AgentStoreError";
  }
}

export type AgentIdentity = {
  tokenId: string;
  userId: string;
  label: string;
  boundCharacterId: string | null;
  scopes: string[];
};

const TOKEN_PREFIX = "noct_agt_";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function mintSecret(): { raw: string; prefix: string; hash: string } {
  const secret = randomBytes(24).toString("base64url");
  const raw = `${TOKEN_PREFIX}${secret}`;
  return { raw, prefix: raw.slice(0, 16), hash: hashToken(raw) };
}

export function createAgentStore(database: ReturnType<typeof createDatabase>) {
  async function createToken(input: {
    userId: string;
    label?: string;
    boundCharacterId?: string | null;
    scopes?: string[];
  }): Promise<{ tokenId: string; token: string; prefix: string; userId: string; label: string }> {
    const tokenId = randomUUID();
    const { raw, prefix, hash } = mintSecret();
    const label = (input.label || "agent").slice(0, 80);
    const scopes = input.scopes?.length ? input.scopes : ["play"];
    await database.client`
      INSERT INTO game.agent_tokens (
        token_id, user_id, label, token_prefix, token_hash, bound_character_id, scopes
      ) VALUES (
        ${tokenId}, ${input.userId}, ${label}, ${prefix}, ${hash},
        ${input.boundCharacterId || null}, ${scopes}
      )
    `;
    return { tokenId, token: raw, prefix, userId: input.userId, label };
  }

  /** Mint isolated agent user + token (device pairing for external agents). */
  async function bootstrap(input: {
    label?: string;
  }): Promise<{ tokenId: string; token: string; prefix: string; userId: string; label: string }> {
    const userId = `agent:${randomUUID()}`;
    return createToken({ userId, label: input.label || "agent" });
  }

  async function authenticate(
    authorizationHeader: string | undefined,
  ): Promise<AgentIdentity | null> {
    if (!authorizationHeader) return null;
    const match = /^Bearer\s+(\S+)/i.exec(authorizationHeader.trim());
    if (!match) return null;
    const raw = match[1]!;
    if (!raw.startsWith(TOKEN_PREFIX)) return null;
    const hash = hashToken(raw);
    const rows = await database.client`
      SELECT token_id, user_id, label, bound_character_id, scopes
      FROM game.agent_tokens
      WHERE token_hash = ${hash} AND revoked_at IS NULL
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    await database.client`
      UPDATE game.agent_tokens SET last_used_at = now() WHERE token_id = ${row.token_id}
    `;
    return {
      tokenId: String(row.token_id),
      userId: String(row.user_id),
      label: String(row.label),
      boundCharacterId: row.bound_character_id ? String(row.bound_character_id) : null,
      scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : ["play"],
    };
  }

  async function listTokens(userId: string) {
    const rows = await database.client`
      SELECT token_id, label, token_prefix, bound_character_id, scopes, created_at, last_used_at, revoked_at
      FROM game.agent_tokens
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `;
    return rows.map((row) => ({
      tokenId: String(row.token_id),
      label: String(row.label),
      prefix: String(row.token_prefix),
      boundCharacterId: row.bound_character_id ? String(row.bound_character_id) : null,
      scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : ["play"],
      createdAt:
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      lastUsedAt: row.last_used_at
        ? row.last_used_at instanceof Date
          ? row.last_used_at.toISOString()
          : String(row.last_used_at)
        : null,
      revoked: Boolean(row.revoked_at),
    }));
  }

  async function revokeToken(userId: string, tokenId: string) {
    const rows = await database.client`
      UPDATE game.agent_tokens
      SET revoked_at = now()
      WHERE token_id = ${tokenId} AND user_id = ${userId} AND revoked_at IS NULL
      RETURNING token_id
    `;
    if (!rows[0]) throw new AgentStoreError("not_found", "Token not found.");
    return { tokenId, revoked: true };
  }

  async function bindCharacter(tokenId: string, userId: string, characterId: string | null) {
    const rows = await database.client`
      UPDATE game.agent_tokens
      SET bound_character_id = ${characterId}
      WHERE token_id = ${tokenId} AND user_id = ${userId} AND revoked_at IS NULL
      RETURNING token_id, bound_character_id
    `;
    if (!rows[0]) throw new AgentStoreError("not_found", "Token not found.");
    return {
      tokenId: String(rows[0].token_id),
      boundCharacterId: rows[0].bound_character_id ? String(rows[0].bound_character_id) : null,
    };
  }

  return { createToken, bootstrap, authenticate, listTokens, revokeToken, bindCharacter };
}

export type AgentStore = ReturnType<typeof createAgentStore>;
