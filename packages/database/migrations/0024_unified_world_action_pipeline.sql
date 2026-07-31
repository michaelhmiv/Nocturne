-- Unified persistent-world action request and execution audit.

CREATE TABLE IF NOT EXISTS game.world_action_requests (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES game.world_shards(shard_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  actor_id uuid NOT NULL REFERENCES game.entity_instances(instance_id),
  idempotency_key text NOT NULL,
  command text NOT NULL CHECK (btrim(command) <> ''),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN (
    'reserved', 'compiling_context', 'resolving_references', 'planning',
    'waiting_for_clarification', 'executing', 'waiting', 'completed', 'failed',
    'cancelled', 'superseded'
  )),
  context_compilation_id uuid REFERENCES game.context_compilation_audits(compilation_id),
  plan_id uuid REFERENCES game.action_plans(plan_id),
  authoritative_result jsonb,
  player_safe_result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (world_id, idempotency_key),
  CHECK ((status = 'completed') = (player_safe_result IS NOT NULL)),
  CHECK ((status IN ('completed', 'failed', 'cancelled', 'superseded')) = (completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS world_action_requests_actor_idx
  ON game.world_action_requests (world_id, shard_id, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS world_action_requests_status_idx
  ON game.world_action_requests (world_id, shard_id, status, updated_at);

CREATE TABLE IF NOT EXISTS game.world_action_execution_stages (
  stage_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES game.world_action_requests(request_id) ON DELETE CASCADE,
  stage_order integer NOT NULL CHECK (stage_order > 0),
  stage_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'waiting', 'skipped')),
  input_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  output_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (request_id, stage_order)
);

CREATE INDEX IF NOT EXISTS world_action_execution_stages_request_idx
  ON game.world_action_execution_stages (request_id, stage_order);

CREATE TABLE IF NOT EXISTS game.world_action_handler_registry (
  action_kind text PRIMARY KEY CHECK (action_kind ~ '^[a-z][a-z0-9_]{0,63}$'),
  handler_version text NOT NULL,
  authority_mode text NOT NULL CHECK (authority_mode IN (
    'deterministic', 'ai_semantic_then_deterministic', 'scheduled', 'dialogue_only'
  )),
  supports_state_change boolean NOT NULL DEFAULT true,
  description text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO game.world_action_handler_registry (
  action_kind, handler_version, authority_mode, supports_state_change, description
) VALUES
  ('search', 'search-discovery-v1', 'ai_semantic_then_deterministic', true, 'Search, discovery, and bounded materialization.'),
  ('move', 'travel-v2', 'scheduled', true, 'Immediate or scheduled travel with persistent cohorts.'),
  ('consume', 'consumption-v4', 'ai_semantic_then_deterministic', true, 'Open-ended authoritative consumption.'),
  ('relationship', 'relationship-v1', 'ai_semantic_then_deterministic', true, 'Social, accompaniment, custody, and access changes.'),
  ('combat', 'combat-v1', 'ai_semantic_then_deterministic', true, 'Contested physical actions and persistent consequences.'),
  ('transfer', 'transfer-v1', 'deterministic', true, 'Ownership, possession, custody, and resource transfer.'),
  ('interact', 'interaction-v1', 'ai_semantic_then_deterministic', true, 'Open-ended world interaction through universal operations.'),
  ('dialogue', 'dialogue-v1', 'dialogue_only', false, 'Conversation without unauthorized state mutation.'),
  ('question', 'question-v1', 'dialogue_only', false, 'Player-safe question answering from known world facts.')
ON CONFLICT (action_kind) DO UPDATE
SET handler_version = EXCLUDED.handler_version,
    authority_mode = EXCLUDED.authority_mode,
    supports_state_change = EXCLUDED.supports_state_change,
    description = EXCLUDED.description,
    enabled = true,
    updated_at = now();
