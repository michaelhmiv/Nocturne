-- First-class agent API tokens (hashed secrets; plaintext shown once at mint).

CREATE TABLE IF NOT EXISTS game.agent_tokens (
  token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  label text NOT NULL DEFAULT 'agent',
  token_prefix text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  bound_character_id uuid NULL,
  scopes text[] NOT NULL DEFAULT ARRAY['play']::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS agent_tokens_user_idx
  ON game.agent_tokens (user_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS agent_tokens_hash_idx
  ON game.agent_tokens (token_hash)
  WHERE revoked_at IS NULL;
