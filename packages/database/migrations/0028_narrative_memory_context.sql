-- Player-safe narrative memory is a derived projection over authoritative events.
-- It is never a source of mechanical truth and may be rebuilt from the event ledger.

CREATE TABLE IF NOT EXISTS game.scene_summaries (
  scene_summary_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES game.world_shards(shard_id) ON DELETE CASCADE,
  viewpoint_id uuid NOT NULL REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  location_id uuid REFERENCES game.entity_instances(instance_id) ON DELETE SET NULL,
  summary text NOT NULL DEFAULT '',
  unresolved_threads jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_event_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, shard_id, viewpoint_id, location_id)
);

CREATE INDEX IF NOT EXISTS scene_summaries_lookup_idx
  ON game.scene_summaries (world_id, shard_id, viewpoint_id, location_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS game.narrative_memories (
  memory_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES game.world_shards(shard_id) ON DELETE CASCADE,
  viewpoint_id uuid NOT NULL REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  location_id uuid REFERENCES game.entity_instances(instance_id) ON DELETE SET NULL,
  source_request_id uuid REFERENCES game.world_action_requests(request_id) ON DELETE SET NULL,
  summary text NOT NULL CHECK (btrim(summary) <> ''),
  salience integer NOT NULL DEFAULT 0 CHECK (salience BETWEEN -10000 AND 10000),
  visibility text NOT NULL DEFAULT 'player_known' CHECK (visibility = 'player_known'),
  unresolved boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, shard_id, viewpoint_id, source_request_id)
);

CREATE INDEX IF NOT EXISTS narrative_memories_relevance_idx
  ON game.narrative_memories (
    world_id, shard_id, viewpoint_id, unresolved DESC, salience DESC, occurred_at DESC
  );
CREATE INDEX IF NOT EXISTS narrative_memories_location_idx
  ON game.narrative_memories (world_id, shard_id, viewpoint_id, location_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS game.memory_source_events (
  memory_id uuid NOT NULL REFERENCES game.narrative_memories(memory_id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES game.event_ledger(event_id) ON DELETE CASCADE,
  PRIMARY KEY (memory_id, event_id)
);

CREATE INDEX IF NOT EXISTS memory_source_events_event_idx
  ON game.memory_source_events (event_id, memory_id);

CREATE TABLE IF NOT EXISTS game.memory_mentions (
  memory_id uuid NOT NULL REFERENCES game.narrative_memories(memory_id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  PRIMARY KEY (memory_id, entity_id)
);

CREATE INDEX IF NOT EXISTS memory_mentions_entity_idx
  ON game.memory_mentions (entity_id, memory_id);
