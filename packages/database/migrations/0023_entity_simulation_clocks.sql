-- Lazy simulation policies, leases, and authoritative simulation history.

CREATE TABLE IF NOT EXISTS game.entity_simulation_policies (
  policy_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  definition_type text,
  definition_id text REFERENCES game.entity_definitions(definition_id),
  policy_version text NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  minimum_interval_seconds integer NOT NULL DEFAULT 300 CHECK (minimum_interval_seconds >= 60),
  maximum_elapsed_seconds integer NOT NULL DEFAULT 604800 CHECK (maximum_elapsed_seconds >= minimum_interval_seconds),
  state_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_operation_types jsonb NOT NULL DEFAULT '[]'::jsonb,
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dormant', 'retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (definition_type IS NOT NULL OR definition_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS entity_simulation_policy_definition_uq
  ON game.entity_simulation_policies (
    COALESCE(world_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(definition_id, ''),
    COALESCE(definition_type, ''),
    policy_version
  );

ALTER TABLE game.entity_instances
  ADD COLUMN IF NOT EXISTS simulation_policy_id uuid REFERENCES game.entity_simulation_policies(policy_id),
  ADD COLUMN IF NOT EXISTS simulation_lease_owner text,
  ADD COLUMN IF NOT EXISTS simulation_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS simulation_version bigint NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS entity_instances_simulation_claim_idx
  ON game.entity_instances (
    world_id, shard_id, next_simulation_at, simulation_lease_expires_at
  )
  WHERE simulation_policy_id IS NOT NULL
    AND lifecycle_status IN ('active', 'dormant', 'incapacitated', 'missing');

CREATE TABLE IF NOT EXISTS game.entity_simulation_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES game.world_shards(shard_id) ON DELETE CASCADE,
  entity_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  policy_id uuid NOT NULL REFERENCES game.entity_simulation_policies(policy_id),
  idempotency_key text NOT NULL,
  elapsed_seconds integer NOT NULL CHECK (elapsed_seconds >= 0),
  starting_entity_version bigint NOT NULL,
  starting_simulation_version bigint NOT NULL,
  context_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  proposal jsonb,
  result_receipt_id uuid REFERENCES game.mutation_receipts(receipt_id),
  result_event_id uuid REFERENCES game.event_ledger(event_id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'analyzing', 'committed', 'no_change', 'stale', 'failed'
  )),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (world_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS entity_simulation_runs_entity_idx
  ON game.entity_simulation_runs (world_id, shard_id, entity_instance_id, created_at DESC);

INSERT INTO game.entity_simulation_policies (
  policy_id,
  definition_type,
  policy_version,
  name,
  description,
  minimum_interval_seconds,
  maximum_elapsed_seconds,
  state_keys,
  allowed_operation_types,
  constraints
) VALUES (
  '72000000-0000-4000-8000-000000000001',
  'animal',
  'animal-lazy-v1',
  'Ordinary animal lazy simulation',
  'Updates bounded unattended animal needs, rest, fear, trust decay, healing or deterioration, and plausible local movement.',
  900,
  604800,
  '["hunger","thirst","fatigue","fear","trust","injury","resting","secured","escape_risk"]'::jsonb,
  '["set_state_value","set_condition","adjust_condition","move_entity","set_relation","remove_relation"]'::jsonb,
  '[
    "Do not create new entities.",
    "Do not establish ownership or control.",
    "Do not move through inaccessible routes.",
    "Do not kill an entity unless current state and elapsed time make death an authorized bounded outcome.",
    "Do not reveal hidden changes until observed.",
    "Prefer no change over unsupported change."
  ]'::jsonb
) ON CONFLICT (policy_id) DO NOTHING;

UPDATE game.entity_instances instance
SET simulation_policy_id = '72000000-0000-4000-8000-000000000001',
    next_simulation_at = COALESCE(instance.next_simulation_at, now() + interval '15 minutes')
FROM game.entity_definitions definition
WHERE definition.definition_id = instance.definition_id
  AND definition.definition_type = 'animal'
  AND instance.simulation_policy_id IS NULL;
