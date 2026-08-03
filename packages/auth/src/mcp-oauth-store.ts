import { createHash } from "node:crypto";
import { Pool } from "pg";

export type McpOAuthGrant = {
  grantId: string;
  userId: string;
  clientIdHash: string;
  scope: string;
  resource: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type CreateMcpOAuthGrant = {
  grantId: string;
  userId: string;
  clientId: string;
  scope: string;
  resource: string;
  expiresAt: Date;
};

export interface McpOAuthStore {
  createGrant(input: CreateMcpOAuthGrant): Promise<void>;
  recordAuthorizationCode(input: {
    codeHash: string;
    grantId: string;
    expiresAt: Date;
  }): Promise<void>;
  consumeAuthorizationCode(input: { codeHash: string; grantId: string }): Promise<boolean>;
  recordRefreshToken(input: {
    tokenHash: string;
    grantId: string;
    expiresAt: Date;
  }): Promise<void>;
  rotateRefreshToken(input: { tokenHash: string; grantId: string }): Promise<boolean>;
  isGrantActive(input: {
    grantId: string;
    userId: string;
    clientId: string;
  }): Promise<boolean>;
  listGrants(userId: string): Promise<McpOAuthGrant[]>;
  revokeGrant(input: { userId: string; grantId: string }): Promise<boolean>;
  revokeAllGrants(userId: string): Promise<number>;
  close(): Promise<void>;
}

export function mcpClientIdHash(clientId: string) {
  return createHash("sha256").update(clientId).digest("hex");
}

export class MemoryMcpOAuthStore implements McpOAuthStore {
  private readonly grants = new Map<string, McpOAuthGrant>();
  private readonly codes = new Map<
    string,
    { grantId: string; expiresAt: Date; consumedAt: Date | null }
  >();
  private readonly refreshTokens = new Map<
    string,
    { grantId: string; expiresAt: Date; rotatedAt: Date | null; revokedAt: Date | null }
  >();

  async createGrant(input: CreateMcpOAuthGrant) {
    this.grants.set(input.grantId, {
      grantId: input.grantId,
      userId: input.userId,
      clientIdHash: mcpClientIdHash(input.clientId),
      scope: input.scope,
      resource: input.resource,
      createdAt: new Date(),
      expiresAt: input.expiresAt,
      revokedAt: null,
    });
  }

  async recordAuthorizationCode(input: {
    codeHash: string;
    grantId: string;
    expiresAt: Date;
  }) {
    this.codes.set(input.codeHash, { ...input, consumedAt: null });
  }

  async consumeAuthorizationCode(input: { codeHash: string; grantId: string }) {
    const code = this.codes.get(input.codeHash);
    if (
      !code ||
      code.grantId !== input.grantId ||
      code.consumedAt ||
      code.expiresAt.getTime() <= Date.now()
    ) {
      return false;
    }
    const grant = this.grants.get(input.grantId);
    if (!grant || grant.revokedAt || grant.expiresAt.getTime() <= Date.now()) return false;
    code.consumedAt = new Date();
    return true;
  }

  async recordRefreshToken(input: {
    tokenHash: string;
    grantId: string;
    expiresAt: Date;
  }) {
    this.refreshTokens.set(input.tokenHash, {
      ...input,
      rotatedAt: null,
      revokedAt: null,
    });
  }

  async rotateRefreshToken(input: { tokenHash: string; grantId: string }) {
    const token = this.refreshTokens.get(input.tokenHash);
    if (
      !token ||
      token.grantId !== input.grantId ||
      token.rotatedAt ||
      token.revokedAt ||
      token.expiresAt.getTime() <= Date.now()
    ) {
      return false;
    }
    const grant = this.grants.get(input.grantId);
    if (!grant || grant.revokedAt || grant.expiresAt.getTime() <= Date.now()) return false;
    token.rotatedAt = new Date();
    return true;
  }

  async isGrantActive(input: { grantId: string; userId: string; clientId: string }) {
    const grant = this.grants.get(input.grantId);
    return Boolean(
      grant &&
        grant.userId === input.userId &&
        grant.clientIdHash === mcpClientIdHash(input.clientId) &&
        !grant.revokedAt &&
        grant.expiresAt.getTime() > Date.now(),
    );
  }

  async listGrants(userId: string) {
    return [...this.grants.values()]
      .filter((grant) => grant.userId === userId)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  }

  async revokeGrant(input: { userId: string; grantId: string }) {
    const grant = this.grants.get(input.grantId);
    if (!grant || grant.userId !== input.userId || grant.revokedAt) return false;
    grant.revokedAt = new Date();
    for (const token of this.refreshTokens.values()) {
      if (token.grantId === input.grantId && !token.revokedAt) token.revokedAt = new Date();
    }
    return true;
  }

  async revokeAllGrants(userId: string) {
    let count = 0;
    for (const grant of this.grants.values()) {
      if (grant.userId === userId && !grant.revokedAt) {
        await this.revokeGrant({ userId, grantId: grant.grantId });
        count += 1;
      }
    }
    return count;
  }

  async close() {}
}

export class PostgresMcpOAuthStore implements McpOAuthStore {
  private readonly pool: Pool;

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
  }

  async createGrant(input: CreateMcpOAuthGrant) {
    await this.pool.query(
      `INSERT INTO auth.mcp_oauth_grants
         (grant_id, user_id, client_id_hash, scope, resource, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        input.grantId,
        input.userId,
        mcpClientIdHash(input.clientId),
        input.scope,
        input.resource,
        input.expiresAt,
      ],
    );
  }

  async recordAuthorizationCode(input: {
    codeHash: string;
    grantId: string;
    expiresAt: Date;
  }) {
    await this.pool.query(
      `INSERT INTO auth.mcp_oauth_authorization_codes (code_hash, grant_id, expires_at)
       VALUES ($1, $2, $3)`,
      [input.codeHash, input.grantId, input.expiresAt],
    );
  }

  async consumeAuthorizationCode(input: { codeHash: string; grantId: string }) {
    const result = await this.pool.query(
      `UPDATE auth.mcp_oauth_authorization_codes AS code
       SET consumed_at = now()
       FROM auth.mcp_oauth_grants AS grant
       WHERE code.code_hash = $1
         AND code.grant_id = $2
         AND code.consumed_at IS NULL
         AND code.expires_at > now()
         AND grant.grant_id = code.grant_id
         AND grant.revoked_at IS NULL
         AND grant.expires_at > now()
       RETURNING code.code_hash`,
      [input.codeHash, input.grantId],
    );
    return result.rowCount === 1;
  }

  async recordRefreshToken(input: {
    tokenHash: string;
    grantId: string;
    expiresAt: Date;
  }) {
    await this.pool.query(
      `INSERT INTO auth.mcp_oauth_refresh_tokens (token_hash, grant_id, expires_at)
       VALUES ($1, $2, $3)`,
      [input.tokenHash, input.grantId, input.expiresAt],
    );
  }

  async rotateRefreshToken(input: { tokenHash: string; grantId: string }) {
    const result = await this.pool.query(
      `UPDATE auth.mcp_oauth_refresh_tokens AS token
       SET rotated_at = now()
       FROM auth.mcp_oauth_grants AS grant
       WHERE token.token_hash = $1
         AND token.grant_id = $2
         AND token.rotated_at IS NULL
         AND token.revoked_at IS NULL
         AND token.expires_at > now()
         AND grant.grant_id = token.grant_id
         AND grant.revoked_at IS NULL
         AND grant.expires_at > now()
       RETURNING token.token_hash`,
      [input.tokenHash, input.grantId],
    );
    return result.rowCount === 1;
  }

  async isGrantActive(input: { grantId: string; userId: string; clientId: string }) {
    const result = await this.pool.query(
      `SELECT 1
       FROM auth.mcp_oauth_grants
       WHERE grant_id = $1
         AND user_id = $2
         AND client_id_hash = $3
         AND revoked_at IS NULL
         AND expires_at > now()`,
      [input.grantId, input.userId, mcpClientIdHash(input.clientId)],
    );
    return result.rowCount === 1;
  }

  async listGrants(userId: string) {
    const result = await this.pool.query<{
      grant_id: string;
      user_id: string;
      client_id_hash: string;
      scope: string;
      resource: string;
      created_at: Date;
      expires_at: Date;
      revoked_at: Date | null;
    }>(
      `SELECT grant_id, user_id, client_id_hash, scope, resource,
              created_at, expires_at, revoked_at
       FROM auth.mcp_oauth_grants
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows.map((row) => ({
      grantId: row.grant_id,
      userId: row.user_id,
      clientIdHash: row.client_id_hash,
      scope: row.scope,
      resource: row.resource,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
    }));
  }

  async revokeGrant(input: { userId: string; grantId: string }) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const grant = await client.query(
        `UPDATE auth.mcp_oauth_grants
         SET revoked_at = now()
         WHERE grant_id = $1 AND user_id = $2 AND revoked_at IS NULL
         RETURNING grant_id`,
        [input.grantId, input.userId],
      );
      if (grant.rowCount !== 1) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        `UPDATE auth.mcp_oauth_refresh_tokens
         SET revoked_at = now()
         WHERE grant_id = $1 AND revoked_at IS NULL`,
        [input.grantId],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeAllGrants(userId: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const grants = await client.query<{ grant_id: string }>(
        `UPDATE auth.mcp_oauth_grants
         SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL
         RETURNING grant_id`,
        [userId],
      );
      if (grants.rows.length) {
        await client.query(
          `UPDATE auth.mcp_oauth_refresh_tokens
           SET revoked_at = now()
           WHERE grant_id = ANY($1::text[]) AND revoked_at IS NULL`,
          [grants.rows.map((row) => row.grant_id)],
        );
      }
      await client.query("COMMIT");
      return grants.rows.length;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

export function createMcpOAuthStore(databaseUrl?: string): McpOAuthStore {
  return databaseUrl ? new PostgresMcpOAuthStore(databaseUrl) : new MemoryMcpOAuthStore();
}
