-- Durable entity identity, optimistic concurrency, lifecycle, aliases, and provenance.

ALTER TABLE game.entity_instances
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS retired_at timestamptz,
  ADD COLUMN IF NOT EXISTS retired_event_id uuid REFERENCES game.event_ledger(event_id),
  ADD COLUMN IF NOT EXISTS last_simulated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS next_simulation_at timestamptz,
  ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entity_instances_lifecycle_status_check'
      AND conrelid = 'game.entity_instances'::regclass
  ) THEN
    ALTER TABLE game.entity_instances
      ADD CONSTRAINT entity_instances_lifecycle_status_check
      CHECK (lifecycle_status IN (
        'active',
        'dormant',
        'incapacitated',
        'dead',
        'destroyed',
        'missing',
        'retired',
        'merged'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entity_instances_retirement_shape_check'
      AND conrelid = 'game.entity_instances'::regclass
  ) THEN
    ALTER TABLE game.entity_instances
      ADD CONSTRAINT entity_instances_retirement_shape_check
      CHECK (
        (lifecycle_status IN ('active', 'dormant', 'incapacitated', 'missing') AND retired_at IS NULL)
        OR
        (lifecycle_status IN ('dead', 'destroyed', 'retired', 'merged') AND retired_at IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS entity_instances_world_lifecycle_idx
  ON game.entity_instances (world_id, shard_id, lifecycle_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS entity_instances_simulation_due_idx
  ON game.entity_instances (world_id, shard_id, next_simulation_at)
  WHERE next_simulation_at IS NOT NULL
    AND lifecycle_status IN ('active', 'dormant', 'incapacitated', 'missing');

CREATE TABLE IF NOT EXISTS game.entity_aliases (
  alias_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  entity_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  viewpoint_instance_id uuid REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  alias_text text NOT NULL CHECK (btrim(alias_text) <> ''),
  normalized_alias text GENERATED ALWAYS AS (lower(regexp_replace(btrim(alias_text), '\s+', ' ', 'g'))) STORED,
  alias_type text NOT NULL DEFAULT 'descriptive'
    CHECK (alias_type IN (
      'canonical',
      'public',
      'descriptive',
      'private',
      'mistaken',
      'former'
    )),
  confidence numeric(5,4) NOT NULL DEFAULT 1 CHECK (confidence >= 0 AND confidence <= 1),
  source_event_id uuid REFERENCES game.event_ledger(event_id),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  superseded_by_alias_id uuid REFERENCES game.entity_aliases(alias_id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CHECK (viewpoint_instance_id IS NOT NULL OR alias_type IN ('canonical', 'public', 'descriptive', 'former'))
);

CREATE UNIQUE INDEX IF NOT EXISTS entity_aliases_active_uq
  ON game.entity_aliases (
    world_id,
    entity_instance_id,
    COALESCE(viewpoint_instance_id, '00000000-0000-0000-0000-000000000000'::uuid),
    normalized_alias,
    alias_type
  )
  WHERE valid_until IS NULL;
CREATE INDEX IF NOT EXISTS entity_aliases_lookup_idx
  ON game.entity_aliases (
    world_id,
    normalized_alias,
    COALESCE(viewpoint_instance_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE valid_until IS NULL;
CREATE INDEX IF NOT EXISTS entity_aliases_entity_idx
  ON game.entity_aliases (world_id, entity_instance_id, valid_from DESC);

CREATE TABLE IF NOT EXISTS game.entity_provenance (
  provenance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  entity_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN (
    'seed',
    'migration',
    'ai_materialization',
    'ambient_pool',
    'population_reservoir',
    'prior_event',
    'player_creation',
    'crafting',
    'invention',
    'scheduled_arrival',
    'administrative_repair'
  )),
  source_id text,
  policy_version text,
  input_hash text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_event_id uuid REFERENCES game.event_ledger(event_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, entity_instance_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS entity_provenance_entity_idx
  ON game.entity_provenance (world_id, entity_instance_id, created_at);
CREATE INDEX IF NOT EXISTS entity_provenance_source_idx
  ON game.entity_provenance (world_id, source_type, source_id);

CREATE TABLE IF NOT EXISTS game.entity_tombstones (
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  entity_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id),
  lifecycle_status text NOT NULL CHECK (lifecycle_status IN ('dead', 'destroyed', 'retired', 'merged')),
  surviving_entity_id uuid REFERENCES game.entity_instances(instance_id),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  event_id uuid NOT NULL REFERENCES game.event_ledger(event_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, entity_instance_id),
  CHECK (surviving_entity_id IS NULL OR surviving_entity_id <> entity_instance_id),
  CHECK ((lifecycle_status = 'merged') = (surviving_entity_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS entity_tombstones_survivor_idx
  ON game.entity_tombstones (world_id, surviving_entity_id)
  WHERE surviving_entity_id IS NOT NULL;

-- Current seeded and prototype instances receive canonical public aliases and
-- explicit migration provenance. This creates durable identity without making
-- every player's private name globally visible.
INSERT INTO game.entity_aliases (
  world_id,
  entity_instance_id,
  alias_text,
  alias_type,
  confidence,
  metadata
)
SELECT
  instance.world_id,
  instance.instance_id,
  definition.name,
  'canonical',
  1,
  '{"backfilled":true}'::jsonb
FROM game.entity_instances instance
JOIN game.entity_definitions definition
  ON definition.definition_id = instance.definition_id
ON CONFLICT DO NOTHING;

INSERT INTO game.entity_provenance (
  world_id,
  entity_instance_id,
  source_type,
  source_id,
  policy_version,
  payload
)
SELECT
  instance.world_id,
  instance.instance_id,
  'migration',
  '0014_entity_lifecycle_aliases_and_versions',
  'entity-identity-v1',
  jsonb_build_object('originalCreatedAt', instance.created_at)
FROM game.entity_instances instance
ON CONFLICT DO NOTHING;
