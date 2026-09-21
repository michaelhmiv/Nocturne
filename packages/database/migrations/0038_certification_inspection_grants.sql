-- Dedicated certification inspection capability; NEVER a game-world operator role.
-- No credentials are created by this migration. No default-world grant is allowed.
-- Certification is an inspector capability only; it never changes player membership or repair roles.
CREATE TABLE IF NOT EXISTS game.certification_runs (
  run_id uuid PRIMARY KEY,
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'revoked')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (world_id <> '00000000-0000-4000-8000-000000000001'::uuid),
  FOREIGN KEY (world_id, shard_id)
    REFERENCES game.world_shards(world_id, shard_id) ON DELETE CASCADE,
  CHECK (expires_at <= created_at + interval '2 hours')
);
CREATE INDEX IF NOT EXISTS certification_runs_expiry_idx
  ON game.certification_runs (status, expires_at);

CREATE TABLE IF NOT EXISTS game.certification_inspection_grants (
  grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES game.certification_runs(run_id) ON DELETE CASCADE,
  token_sha256 text NOT NULL UNIQUE
    CHECK (token_sha256 ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at <= issued_at + interval '2 hours')
);
CREATE INDEX IF NOT EXISTS certification_inspection_grants_run_idx
  ON game.certification_inspection_grants (run_id, expires_at);

-- Audits contain no raw token, plaintext credential, request body or hidden entity.
CREATE TABLE IF NOT EXISTS game.certification_inspection_audit (
  audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid REFERENCES game.certification_inspection_grants(grant_id) ON DELETE SET NULL,
  run_id uuid REFERENCES game.certification_runs(run_id) ON DELETE SET NULL,
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES game.world_shards(shard_id) ON DELETE CASCADE,
  entity_id uuid NOT NULL,
  granted boolean NOT NULL,
  reason text NOT NULL CHECK (reason IN ('read', 'entity_not_found', 'expired_or_revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS certification_inspection_audit_run_idx
  ON game.certification_inspection_audit (run_id, created_at DESC);
