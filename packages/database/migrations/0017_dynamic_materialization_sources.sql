-- Bounded open-ended entity materialization sources and history.

CREATE TABLE IF NOT EXISTS game.materialization_sources (
  source_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES game.world_shards(shard_id) ON DELETE CASCADE,
  location_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN (
    'population_reservoir',
    'ecology_profile',
    'ambient_resource_pool',
    'property_contents_profile',
    'encounter_source',
    'prior_event',
    'scheduled_arrival',
    'explicit_creation'
  )),
  name text NOT NULL CHECK (btrim(name) <> ''),
  description text NOT NULL CHECK (btrim(description) <> ''),
  semantic_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  capacity numeric(12,3) NOT NULL DEFAULT 0 CHECK (capacity >= 0),
  maximum_capacity numeric(12,3) NOT NULL DEFAULT 0 CHECK (maximum_capacity >= 0),
  regeneration_policy jsonb NOT NULL DEFAULT '{"kind":"none"}'::jsonb,
  rarity_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'depleted', 'dormant', 'retired')),
  version bigint NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_event_id uuid REFERENCES game.event_ledger(event_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (capacity <= maximum_capacity)
);

CREATE INDEX IF NOT EXISTS materialization_sources_location_idx
  ON game.materialization_sources (
    world_id, shard_id, location_instance_id, source_type, status
  );
CREATE INDEX IF NOT EXISTS materialization_sources_available_idx
  ON game.materialization_sources (
    world_id, shard_id, location_instance_id, source_type
  )
  WHERE status = 'active' AND capacity > 0;

CREATE TABLE IF NOT EXISTS game.materialization_requests (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES game.world_shards(shard_id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  actor_id uuid REFERENCES game.entity_instances(instance_id),
  location_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id),
  requested_concept text NOT NULL CHECK (btrim(requested_concept) <> ''),
  authoritative_context jsonb NOT NULL CHECK (jsonb_typeof(authoritative_context) = 'object'),
  proposal jsonb,
  validation_result jsonb,
  selected_source_id uuid REFERENCES game.materialization_sources(source_id),
  existing_entity_id uuid REFERENCES game.entity_instances(instance_id),
  materialized_entity_id uuid REFERENCES game.entity_instances(instance_id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',
      'proposed',
      'existing_selected',
      'materialized',
      'rejected',
      'failed'
    )),
  source_event_id uuid REFERENCES game.event_ledger(event_id),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (world_id, idempotency_key),
  CHECK (
    (status IN ('pending', 'proposed', 'failed') AND completed_at IS NULL)
    OR (status IN ('existing_selected', 'materialized', 'rejected') AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS materialization_requests_location_idx
  ON game.materialization_requests (
    world_id, shard_id, location_instance_id, created_at DESC
  );
CREATE INDEX IF NOT EXISTS materialization_requests_source_idx
  ON game.materialization_requests (world_id, selected_source_id, created_at DESC);

CREATE TABLE IF NOT EXISTS game.materialization_history (
  history_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES game.world_shards(shard_id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES game.materialization_sources(source_id),
  request_id uuid NOT NULL REFERENCES game.materialization_requests(request_id),
  entity_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id),
  units_consumed numeric(12,3) NOT NULL DEFAULT 1 CHECK (units_consumed > 0),
  semantic_fingerprint text NOT NULL CHECK (semantic_fingerprint ~ '^[a-f0-9]{64}$'),
  event_id uuid NOT NULL REFERENCES game.event_ledger(event_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id),
  UNIQUE (world_id, entity_instance_id)
);

CREATE INDEX IF NOT EXISTS materialization_history_source_idx
  ON game.materialization_history (world_id, source_id, created_at DESC);

-- The starter alley can plausibly contain a small, bounded number of ordinary
-- urban animals. This source is semantic and constrained; it is not a dog list.
INSERT INTO game.materialization_sources (
  source_id,
  world_id,
  shard_id,
  location_instance_id,
  source_type,
  name,
  description,
  semantic_scope,
  constraints,
  capacity,
  maximum_capacity,
  regeneration_policy,
  rarity_policy,
  metadata
) VALUES (
  '71000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000006',
  'population_reservoir',
  'Ordinary urban animals',
  'A small background population of plausible ordinary animals moving through the rear alley and surrounding blocks.',
  '{
    "families":["ordinary urban animal","domestic animal","small wildlife"],
    "environment":"dense Atlantic coastal city"
  }'::jsonb,
  '[
    "No exotic, supernatural, rare, or implausibly large animal may be produced without another authoritative source.",
    "Prefer an existing compatible hidden entity before materializing a new one.",
    "A player request does not guarantee that the requested animal is present.",
    "Materialized entities are unique persistent instances."
  ]'::jsonb,
  4,
  4,
  '{"kind":"slow","unitsPerDay":0.25,"requiresBelowMaximum":true}'::jsonb,
  '{"ordinary":0.85,"uncommon":0.14,"rare":0.01}'::jsonb,
  '{"starterSource":true,"catalogue":false}'::jsonb
) ON CONFLICT (source_id) DO NOTHING;
