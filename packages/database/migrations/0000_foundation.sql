CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS game;
CREATE SCHEMA IF NOT EXISTS system;

CREATE TABLE IF NOT EXISTS game.entity_definitions (
  definition_id text PRIMARY KEY,
  definition_type text NOT NULL,
  name text NOT NULL,
  concept_summary text NOT NULL,
  origin_source text,
  lifecycle_status text NOT NULL DEFAULT 'provisional',
  current_revision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game.definition_revisions (
  revision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id text NOT NULL REFERENCES game.entity_definitions(definition_id) ON DELETE CASCADE,
  schema_version text NOT NULL DEFAULT 'content-v1',
  payload jsonb NOT NULL,
  change_summary text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (definition_id, revision_id)
);

ALTER TABLE game.entity_definitions
  ADD CONSTRAINT entity_definitions_current_revision_fk
  FOREIGN KEY (definition_id, current_revision_id)
  REFERENCES game.definition_revisions(definition_id, revision_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS game.entity_instances (
  instance_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  definition_id text NOT NULL REFERENCES game.entity_definitions(definition_id),
  owner_id uuid,
  controller_id uuid,
  location_id uuid,
  condition integer NOT NULL DEFAULT 100 CHECK (condition BETWEEN 0 AND 100),
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game.generated_content_requests (
  request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL,
  raw_concept text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  draft_payload jsonb,
  validation_status text NOT NULL DEFAULT 'drafting',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game.action_intents (
  intent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  raw_text text NOT NULL,
  parsed_intent jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game.resolution_results (
  resolution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id uuid NOT NULL REFERENCES game.action_intents(intent_id),
  outcome_grade text NOT NULL,
  calculation_trace jsonb NOT NULL,
  proposed_operations jsonb NOT NULL,
  narrative_constraints jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game.event_ledger (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  world_time timestamptz NOT NULL,
  event_type text NOT NULL,
  involved_entity_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL,
  source_intent_id uuid,
  supersedes_event_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE game.event_ledger
  ADD CONSTRAINT event_ledger_source_intent_fk
  FOREIGN KEY (source_intent_id) REFERENCES game.action_intents(intent_id),
  ADD CONSTRAINT event_ledger_supersedes_event_fk
  FOREIGN KEY (supersedes_event_id) REFERENCES game.event_ledger(event_id);

ALTER TABLE game.entity_instances
  ADD CONSTRAINT entity_instances_created_event_fk
  FOREIGN KEY (created_event_id) REFERENCES game.event_ledger(event_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS system.ai_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task text NOT NULL,
  authority text NOT NULL,
  requested_model text NOT NULL,
  actual_model text,
  prompt_policy_version text NOT NULL,
  provider_request_id text,
  status text NOT NULL,
  input_hash text NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS entity_definitions_type_idx ON game.entity_definitions(definition_type);
CREATE INDEX IF NOT EXISTS entity_definitions_status_idx ON game.entity_definitions(lifecycle_status);
CREATE INDEX IF NOT EXISTS definition_revisions_definition_idx ON game.definition_revisions(definition_id);
CREATE INDEX IF NOT EXISTS entity_instances_definition_idx ON game.entity_instances(definition_id);
CREATE INDEX IF NOT EXISTS entity_instances_owner_idx ON game.entity_instances(owner_id);
CREATE INDEX IF NOT EXISTS entity_instances_location_idx ON game.entity_instances(location_id);
CREATE INDEX IF NOT EXISTS generated_content_requests_creator_idx ON game.generated_content_requests(creator_id);
CREATE INDEX IF NOT EXISTS generated_content_requests_status_idx ON game.generated_content_requests(validation_status);
CREATE INDEX IF NOT EXISTS action_intents_actor_idx ON game.action_intents(actor_id);
CREATE INDEX IF NOT EXISTS resolution_results_intent_idx ON game.resolution_results(intent_id);
CREATE INDEX IF NOT EXISTS event_ledger_world_time_idx ON game.event_ledger(world_time);
CREATE INDEX IF NOT EXISTS event_ledger_type_idx ON game.event_ledger(event_type);
CREATE INDEX IF NOT EXISTS event_ledger_entities_gin ON game.event_ledger USING gin(involved_entity_ids jsonb_path_ops);
CREATE INDEX IF NOT EXISTS ai_runs_task_idx ON system.ai_runs(task);

CREATE OR REPLACE FUNCTION game.reject_immutable_row_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '%.% is append-only', TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER definition_revisions_append_only
BEFORE UPDATE OR DELETE ON game.definition_revisions
FOR EACH ROW EXECUTE FUNCTION game.reject_immutable_row_change();

CREATE TRIGGER event_ledger_append_only
BEFORE UPDATE OR DELETE ON game.event_ledger
FOR EACH ROW EXECUTE FUNCTION game.reject_immutable_row_change();
