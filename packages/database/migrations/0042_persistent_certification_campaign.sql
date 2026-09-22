-- Persistent certification is opt-in for isolated test worlds only.
-- Ordinary certification runs retain their original two-hour TTL.
ALTER TABLE game.certification_runs
  ADD COLUMN IF NOT EXISTS persistent_campaign boolean NOT NULL DEFAULT false;

DO $$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'game.certification_runs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%expires_at%'
      AND pg_get_constraintdef(oid) LIKE '%created_at%'
  LOOP
    EXECUTE format(
      'ALTER TABLE game.certification_runs DROP CONSTRAINT %I',
      v_constraint.conname
    );
  END LOOP;
END $$;

-- Preserve pre-existing long-lived runs only when their world is explicitly
-- an isolated certification world; never grant this lifetime to public worlds.
UPDATE game.certification_runs AS cert
SET persistent_campaign = true
FROM game.worlds AS world
WHERE world.world_id = cert.world_id
  AND world.metadata->>'isolatedCertification' = 'true'
  AND cert.expires_at > cert.created_at + interval '2 hours'
  AND cert.expires_at <= cert.created_at + interval '365 days';

ALTER TABLE game.certification_runs
  ADD CONSTRAINT certification_runs_lifetime_policy CHECK (
    (NOT persistent_campaign AND expires_at <= created_at + interval '2 hours')
    OR (persistent_campaign AND expires_at <= created_at + interval '365 days')
  );

CREATE TABLE IF NOT EXISTS system.persistent_campaigns (
  campaign_key text PRIMARY KEY CHECK (campaign_key ~ '^[a-z0-9_-]{8,100}$'),
  run_id uuid NOT NULL UNIQUE REFERENCES game.certification_runs(run_id),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id),
  shard_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (world_id, shard_id)
    REFERENCES game.world_shards(world_id, shard_id)
);

CREATE TABLE IF NOT EXISTS system.persistent_campaign_beats (
  campaign_key text NOT NULL REFERENCES system.persistent_campaigns(campaign_key),
  sequence integer NOT NULL CHECK (sequence >= 0),
  beat_id text NOT NULL,
  actor_alias text NOT NULL,
  verdict text NOT NULL,
  result jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_key, sequence)
);
CREATE INDEX IF NOT EXISTS persistent_campaign_beats_latest_idx
  ON system.persistent_campaign_beats (campaign_key, sequence DESC);
