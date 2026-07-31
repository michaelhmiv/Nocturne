-- Relevance-ranked context salience and explainable compilation audits.

CREATE TABLE IF NOT EXISTS game.entity_salience (
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES game.world_shards(shard_id) ON DELETE CASCADE,
  viewpoint_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  entity_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  score integer NOT NULL DEFAULT 0 CHECK (score >= -10000 AND score <= 10000),
  reasons jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reasons) = 'array'),
  source_event_id uuid REFERENCES game.event_ledger(event_id),
  last_referenced_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (world_id, shard_id, viewpoint_instance_id, entity_instance_id),
  CHECK (viewpoint_instance_id <> entity_instance_id)
);

CREATE INDEX IF NOT EXISTS entity_salience_viewpoint_idx
  ON game.entity_salience (
    world_id, shard_id, viewpoint_instance_id, score DESC, last_referenced_at DESC
  )
  WHERE expires_at IS NULL OR expires_at > now();

CREATE TABLE IF NOT EXISTS game.context_compilation_audits (
  compilation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES game.world_shards(shard_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  viewpoint_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id),
  command_hash text NOT NULL CHECK (command_hash ~ '^[a-f0-9]{64}$'),
  command_excerpt text NOT NULL,
  explicit_entity_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  candidate_scores jsonb NOT NULL DEFAULT '[]'::jsonb,
  selected_fact_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  omitted_candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  fact_count integer NOT NULL DEFAULT 0 CHECK (fact_count >= 0),
  estimated_tokens integer NOT NULL DEFAULT 0 CHECK (estimated_tokens >= 0),
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS context_compilation_viewpoint_idx
  ON game.context_compilation_audits (
    world_id, shard_id, viewpoint_instance_id, created_at DESC
  );
CREATE INDEX IF NOT EXISTS context_compilation_command_idx
  ON game.context_compilation_audits (world_id, command_hash, created_at DESC);

-- Active knowledge queries should ignore invalidated assets by default.
CREATE INDEX IF NOT EXISTS information_assets_world_active_subject_idx
  ON game.information_assets (
    world_id, holder_instance_id, subject_instance_id, created_at DESC
  )
  WHERE valid_until IS NULL;
