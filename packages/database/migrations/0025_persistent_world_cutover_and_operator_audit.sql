-- Persistent-world runtime cutover controls and operator repair audit.

CREATE TABLE IF NOT EXISTS game.runtime_features (
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  feature_key text NOT NULL CHECK (feature_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  enabled boolean NOT NULL DEFAULT false,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, feature_key)
);

INSERT INTO game.runtime_features (world_id, feature_key, enabled, configuration)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'persistent_world_runtime',
  false,
  '{
    "runtimeVersion":"persistent-world-v1",
    "legacyMutationRoutesEnabled":true,
    "severeOfflinePvpEnabled":false,
    "irreversiblePvpEnabled":false
  }'::jsonb
)
ON CONFLICT (world_id, feature_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS game.world_state_archives (
  archive_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  archive_kind text NOT NULL CHECK (archive_kind IN (
    'pre_cutover', 'manual_snapshot', 'rollback_checkpoint', 'prototype_archive'
  )),
  database_reference text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  restored_at timestamptz,
  restore_event_id uuid REFERENCES game.event_ledger(event_id)
);

CREATE INDEX IF NOT EXISTS world_state_archives_world_idx
  ON game.world_state_archives (world_id, created_at DESC);

CREATE TABLE IF NOT EXISTS game.operator_actions (
  operator_action_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES game.world_shards(shard_id) ON DELETE CASCADE,
  operator_user_id text NOT NULL,
  action_type text NOT NULL CHECK (action_type IN (
    'inspect', 'cancel_plan', 'relocate_entity', 'repair_relation',
    'compensating_event', 'merge_location', 'restore_archive',
    'toggle_runtime_feature'
  )),
  target_entity_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  target_plan_id uuid REFERENCES game.action_plans(plan_id),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_event_id uuid REFERENCES game.event_ledger(event_id),
  result_receipt_id uuid REFERENCES game.mutation_receipts(receipt_id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'completed', 'failed', 'cancelled'
  )),
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS operator_actions_world_idx
  ON game.operator_actions (world_id, created_at DESC);
CREATE INDEX IF NOT EXISTS operator_actions_entity_gin_idx
  ON game.operator_actions USING gin (target_entity_ids);

CREATE TABLE IF NOT EXISTS game.compensating_event_links (
  compensating_event_id uuid PRIMARY KEY REFERENCES game.event_ledger(event_id) ON DELETE CASCADE,
  original_event_id uuid NOT NULL REFERENCES game.event_ledger(event_id),
  operator_action_id uuid NOT NULL REFERENCES game.operator_actions(operator_action_id),
  compensation_kind text NOT NULL,
  explanation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (compensating_event_id <> original_event_id)
);

CREATE INDEX IF NOT EXISTS compensating_event_links_original_idx
  ON game.compensating_event_links (original_event_id, created_at DESC);
