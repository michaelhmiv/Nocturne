-- Durable OAuth grant and refresh-token state for the public Nocturne MCP
-- authorization server. Raw authorization codes and refresh tokens are never
-- stored; only SHA-256 hashes are persisted.

CREATE TABLE IF NOT EXISTS auth.mcp_oauth_grants (
  grant_id text PRIMARY KEY,
  user_id text NOT NULL,
  client_id_hash text NOT NULL CHECK (length(client_id_hash) = 64),
  scope text NOT NULL,
  resource text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS mcp_oauth_grants_user_created_idx
  ON auth.mcp_oauth_grants (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS mcp_oauth_grants_active_idx
  ON auth.mcp_oauth_grants (grant_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth.mcp_oauth_authorization_codes (
  code_hash text PRIMARY KEY CHECK (length(code_hash) = 64),
  grant_id text NOT NULL REFERENCES auth.mcp_oauth_grants(grant_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS mcp_oauth_authorization_codes_grant_idx
  ON auth.mcp_oauth_authorization_codes (grant_id);

CREATE TABLE IF NOT EXISTS auth.mcp_oauth_refresh_tokens (
  token_hash text PRIMARY KEY CHECK (length(token_hash) = 64),
  grant_id text NOT NULL REFERENCES auth.mcp_oauth_grants(grant_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  rotated_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS mcp_oauth_refresh_tokens_grant_idx
  ON auth.mcp_oauth_refresh_tokens (grant_id);

CREATE INDEX IF NOT EXISTS mcp_oauth_refresh_tokens_active_idx
  ON auth.mcp_oauth_refresh_tokens (grant_id, expires_at)
  WHERE rotated_at IS NULL AND revoked_at IS NULL;
