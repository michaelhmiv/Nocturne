-- Hierarchical geography, spatial identity, and bounded minor-location capacity.

CREATE TABLE IF NOT EXISTS game.location_profiles (
  location_instance_id uuid PRIMARY KEY REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES game.world_shards(shard_id) ON DELETE CASCADE,
  parent_location_id uuid REFERENCES game.entity_instances(instance_id),
  normalized_family text NOT NULL CHECK (normalized_family ~ '^[a-z][a-z0-9_]{0,63}$'),
  semantic_type text NOT NULL CHECK (btrim(semantic_type) <> ''),
  spatial_cell text NOT NULL CHECK (btrim(spatial_cell) <> ''),
  approximate_position jsonb NOT NULL DEFAULT '{}'::jsonb,
  footprint jsonb NOT NULL DEFAULT '{}'::jsonb,
  access_pattern jsonb NOT NULL DEFAULT '{}'::jsonb,
  ownership_identity text,
  semantic_fingerprint text NOT NULL CHECK (semantic_fingerprint ~ '^[a-f0-9]{64}$'),
  materialization_status text NOT NULL DEFAULT 'durable'
    CHECK (materialization_status IN ('provisional', 'durable', 'merged', 'retired')),
  source_event_id uuid REFERENCES game.event_ledger(event_id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_location_id IS NULL OR parent_location_id <> location_instance_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS location_profiles_identity_uq
  ON game.location_profiles (
    world_id,
    shard_id,
    COALESCE(parent_location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    spatial_cell,
    normalized_family,
    semantic_fingerprint
  )
  WHERE materialization_status IN ('provisional', 'durable');
CREATE INDEX IF NOT EXISTS location_profiles_parent_idx
  ON game.location_profiles (world_id, shard_id, parent_location_id, normalized_family);
CREATE INDEX IF NOT EXISTS location_profiles_spatial_idx
  ON game.location_profiles (world_id, shard_id, spatial_cell, normalized_family);

CREATE TABLE IF NOT EXISTS game.location_capacities (
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES game.world_shards(shard_id) ON DELETE CASCADE,
  area_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  capacity_key text NOT NULL CHECK (capacity_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  units_available numeric(12,3) NOT NULL DEFAULT 0 CHECK (units_available >= 0),
  maximum_units numeric(12,3) NOT NULL DEFAULT 0 CHECK (maximum_units >= 0),
  regeneration_policy jsonb NOT NULL DEFAULT '{"kind":"none"}'::jsonb,
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, shard_id, area_instance_id, capacity_key),
  CHECK (units_available <= maximum_units)
);

CREATE INDEX IF NOT EXISTS location_capacities_available_idx
  ON game.location_capacities (world_id, shard_id, area_instance_id, capacity_key)
  WHERE units_available > 0;

CREATE TABLE IF NOT EXISTS game.location_materialization_requests (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES game.world_shards(shard_id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  parent_location_id uuid REFERENCES game.entity_instances(instance_id),
  requested_semantics jsonb NOT NULL CHECK (jsonb_typeof(requested_semantics) = 'object'),
  semantic_fingerprint text NOT NULL CHECK (semantic_fingerprint ~ '^[a-f0-9]{64}$'),
  capacity_key text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reused', 'materialized', 'rejected', 'failed')),
  reused_location_id uuid REFERENCES game.entity_instances(instance_id),
  materialized_location_id uuid REFERENCES game.entity_instances(instance_id),
  source_event_id uuid REFERENCES game.event_ledger(event_id),
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (world_id, idempotency_key),
  CHECK (
    (status IN ('pending', 'failed') AND completed_at IS NULL)
    OR (status IN ('reused', 'materialized', 'rejected') AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS location_materialization_parent_idx
  ON game.location_materialization_requests (
    world_id, shard_id, parent_location_id, created_at DESC
  );

-- Backfill the starter and prototype location hierarchy. Unknown legacy spatial
-- positions receive stable cells derived from their IDs; future generated
-- locations use real grid/coordinate identities.
INSERT INTO game.location_profiles (
  location_instance_id,
  world_id,
  shard_id,
  parent_location_id,
  normalized_family,
  semantic_type,
  spatial_cell,
  semantic_fingerprint,
  materialization_status,
  metadata
)
SELECT
  instance.instance_id,
  instance.world_id,
  instance.shard_id,
  instance.location_id,
  CASE
    WHEN definition.definition_type = 'residence' THEN 'room'
    ELSE 'location'
  END,
  definition.definition_type,
  'legacy:' || instance.instance_id::text,
  encode(digest(
    concat_ws('|', instance.world_id::text, instance.location_id::text,
      definition.definition_type, lower(definition.name)),
    'sha256'
  ), 'hex'),
  'durable',
  '{"backfilled":true}'::jsonb
FROM game.entity_instances instance
JOIN game.entity_definitions definition
  ON definition.definition_id = instance.definition_id
WHERE definition.definition_type IN ('location', 'residence')
ON CONFLICT (location_instance_id) DO NOTHING;

-- Initial bounded capacity for minor sublocations beneath Foundry Row. This is
-- an open semantic capacity, not a warehouse or room catalog.
INSERT INTO game.location_capacities (
  world_id,
  shard_id,
  area_instance_id,
  capacity_key,
  units_available,
  maximum_units,
  regeneration_policy,
  constraints
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  'minor_location',
  24,
  24,
  '{"kind":"none"}'::jsonb,
  '[
    "Prefer a compatible existing property or sublocation before materializing another.",
    "Minor spaces must attach to established macro geography.",
    "A requested noun alone is not sufficient identity evidence."
  ]'::jsonb
) ON CONFLICT DO NOTHING;
