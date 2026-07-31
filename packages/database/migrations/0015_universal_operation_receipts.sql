-- Universal transactional world-operation receipts and supporting state.

CREATE TABLE IF NOT EXISTS game.mutation_receipts (
  receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES game.world_shards(shard_id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  authority text NOT NULL CHECK (authority IN ('player', 'scheduled', 'world_simulation', 'operator')),
  actor_id uuid REFERENCES game.entity_instances(instance_id),
  event_id uuid NOT NULL REFERENCES game.event_ledger(event_id),
  symbol_map jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(symbol_map) = 'object'),
  player_visible_facts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(player_visible_facts) = 'array'),
  hidden_facts jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(hidden_facts) = 'array'),
  request_payload jsonb NOT NULL CHECK (jsonb_typeof(request_payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, idempotency_key),
  UNIQUE (event_id)
);

CREATE INDEX IF NOT EXISTS mutation_receipts_actor_idx
  ON game.mutation_receipts (world_id, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mutation_receipts_event_idx
  ON game.mutation_receipts (world_id, event_id);

CREATE TABLE IF NOT EXISTS game.mutation_operation_results (
  receipt_id uuid NOT NULL REFERENCES game.mutation_receipts(receipt_id) ON DELETE CASCADE,
  operation_order integer NOT NULL CHECK (operation_order > 0),
  operation_type text NOT NULL,
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (receipt_id, operation_order)
);

ALTER TABLE game.information_assets
  ADD COLUMN IF NOT EXISTS valid_until timestamptz,
  ADD COLUMN IF NOT EXISTS invalidated_by_event_id uuid REFERENCES game.event_ledger(event_id),
  ADD COLUMN IF NOT EXISTS invalidation_reason text;

CREATE INDEX IF NOT EXISTS information_assets_active_holder_idx
  ON game.information_assets (world_id, holder_instance_id, created_at DESC)
  WHERE valid_until IS NULL;

CREATE TABLE IF NOT EXISTS game.area_effects (
  area_effect_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES game.world_shards(shard_id) ON DELETE CASCADE,
  area_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  effect text NOT NULL CHECK (btrim(effect) <> ''),
  intensity integer NOT NULL DEFAULT 100 CHECK (intensity >= 0 AND intensity <= 100),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_event_id uuid NOT NULL REFERENCES game.event_ledger(event_id),
  resolves_at timestamptz,
  removed_at timestamptz,
  removed_by_event_id uuid REFERENCES game.event_ledger(event_id),
  removal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((removed_at IS NULL) = (removed_by_event_id IS NULL))
);

CREATE INDEX IF NOT EXISTS area_effects_active_area_idx
  ON game.area_effects (world_id, shard_id, area_instance_id, created_at DESC)
  WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS area_effects_due_idx
  ON game.area_effects (world_id, shard_id, resolves_at)
  WHERE resolves_at IS NOT NULL AND removed_at IS NULL;

-- Existing scheduled actions gain durable plan/event/version linkage. Columns
-- are nullable until the dedicated scheduler migration backfills and enforces
-- the final execution protocol.
ALTER TABLE IF EXISTS game.scheduled_actions
  ADD COLUMN IF NOT EXISTS source_event_id uuid REFERENCES game.event_ledger(event_id),
  ADD COLUMN IF NOT EXISTS result_event_id uuid REFERENCES game.event_ledger(event_id),
  ADD COLUMN IF NOT EXISTS cancelled_event_id uuid REFERENCES game.event_ledger(event_id),
  ADD COLUMN IF NOT EXISTS subject_entity_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS expected_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS resolution_policy text NOT NULL DEFAULT 'authoritative-v1',
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

CREATE INDEX IF NOT EXISTS scheduled_actions_world_due_idx
  ON game.scheduled_actions (world_id, shard_id, status, resolves_at)
  WHERE status = 'pending';
