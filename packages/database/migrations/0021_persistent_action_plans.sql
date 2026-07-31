-- Durable, resumable multi-step action plans.

CREATE TABLE IF NOT EXISTS game.action_plans (
  plan_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES game.world_shards(shard_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  actor_id uuid NOT NULL REFERENCES game.entity_instances(instance_id),
  original_command text NOT NULL CHECK (btrim(original_command) <> ''),
  status text NOT NULL DEFAULT 'planned' CHECK (status IN (
    'planned', 'running', 'waiting_for_time', 'waiting_for_world_event',
    'waiting_for_clarification', 'blocked', 'completed', 'partially_completed',
    'failed', 'cancelled', 'superseded'
  )),
  exclusive_physical boolean NOT NULL DEFAULT true,
  active_step_id uuid,
  plan_version bigint NOT NULL DEFAULT 0,
  created_event_id uuid REFERENCES game.event_ledger(event_id),
  superseded_by_plan_id uuid REFERENCES game.action_plans(plan_id),
  clarification_prompt text,
  failure_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK ((status = 'superseded') = (superseded_by_plan_id IS NOT NULL)),
  CHECK ((status = 'waiting_for_clarification') = (clarification_prompt IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS action_plans_actor_exclusive_active_uq
  ON game.action_plans (world_id, shard_id, actor_id)
  WHERE exclusive_physical AND status IN (
    'planned', 'running', 'waiting_for_time', 'waiting_for_world_event',
    'waiting_for_clarification', 'blocked'
  );
CREATE INDEX IF NOT EXISTS action_plans_actor_history_idx
  ON game.action_plans (world_id, shard_id, actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS action_plans_status_idx
  ON game.action_plans (world_id, shard_id, status, updated_at);

CREATE TABLE IF NOT EXISTS game.action_plan_steps (
  step_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES game.action_plans(plan_id) ON DELETE CASCADE,
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  step_order integer NOT NULL CHECK (step_order > 0),
  step_kind text NOT NULL CHECK (step_kind ~ '^[a-z][a-z0-9_]{0,63}$'),
  description text NOT NULL CHECK (btrim(description) <> ''),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'ready', 'running', 'waiting', 'completed', 'failed',
    'cancelled', 'superseded'
  )),
  idempotency_key text NOT NULL,
  intent_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_references jsonb NOT NULL DEFAULT '{}'::jsonb,
  expected_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_event_id uuid REFERENCES game.event_ledger(event_id),
  result_receipt_id uuid REFERENCES game.mutation_receipts(receipt_id),
  outcome_grade text,
  waiting_reason text,
  failure_code text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  UNIQUE (plan_id, step_order),
  UNIQUE (world_id, idempotency_key)
);

ALTER TABLE game.action_plans
  ADD CONSTRAINT action_plans_active_step_fk
  FOREIGN KEY (active_step_id)
  REFERENCES game.action_plan_steps(step_id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS action_plan_steps_ready_idx
  ON game.action_plan_steps (world_id, status, updated_at)
  WHERE status IN ('ready', 'waiting');

CREATE TABLE IF NOT EXISTS game.action_plan_dependencies (
  dependency_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid NOT NULL REFERENCES game.action_plans(plan_id) ON DELETE CASCADE,
  step_id uuid NOT NULL REFERENCES game.action_plan_steps(step_id) ON DELETE CASCADE,
  depends_on_step_id uuid REFERENCES game.action_plan_steps(step_id) ON DELETE CASCADE,
  dependency_type text NOT NULL CHECK (dependency_type IN (
    'after_step_completed', 'after_step_succeeded', 'after_arrival',
    'after_entity_present', 'after_item_acquired', 'after_time',
    'after_event', 'after_clarification', 'after_access_granted'
  )),
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  satisfied_at timestamptz,
  satisfied_by_event_id uuid REFERENCES game.event_ledger(event_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (depends_on_step_id IS NOT NULL OR dependency_type NOT IN (
    'after_step_completed', 'after_step_succeeded'
  )),
  CHECK (depends_on_step_id IS NULL OR depends_on_step_id <> step_id),
  UNIQUE (step_id, dependency_type, depends_on_step_id)
);

CREATE INDEX IF NOT EXISTS action_plan_dependencies_unsatisfied_idx
  ON game.action_plan_dependencies (plan_id, step_id, dependency_type)
  WHERE satisfied_at IS NULL;

CREATE TABLE IF NOT EXISTS game.action_plan_entities (
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES game.action_plans(plan_id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES game.entity_instances(instance_id),
  role text NOT NULL CHECK (role IN (
    'actor', 'target', 'location', 'method', 'resource', 'companion',
    'vehicle', 'container', 'other'
  )),
  reference_text text,
  last_validated_version bigint,
  last_validated_at timestamptz,
  PRIMARY KEY (plan_id, entity_id, role)
);

CREATE INDEX IF NOT EXISTS action_plan_entities_entity_idx
  ON game.action_plan_entities (world_id, entity_id, plan_id);

CREATE TABLE IF NOT EXISTS game.action_plan_events (
  plan_event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES game.action_plans(plan_id) ON DELETE CASCADE,
  step_id uuid REFERENCES game.action_plan_steps(step_id) ON DELETE SET NULL,
  event_type text NOT NULL,
  source_event_id uuid REFERENCES game.event_ledger(event_id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS action_plan_events_plan_idx
  ON game.action_plan_events (plan_id, created_at);

ALTER TABLE IF EXISTS game.scheduled_actions
  ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES game.action_plans(plan_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS step_id uuid REFERENCES game.action_plan_steps(step_id) ON DELETE SET NULL;
