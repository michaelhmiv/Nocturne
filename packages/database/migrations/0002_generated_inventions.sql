ALTER TABLE game.generated_content_requests
  ADD COLUMN IF NOT EXISTS user_id text,
  ADD COLUMN IF NOT EXISTS residence_instance_id uuid REFERENCES game.entity_instances(instance_id),
  ADD COLUMN IF NOT EXISTS definition_id text REFERENCES game.entity_definitions(definition_id),
  ADD COLUMN IF NOT EXISTS installed_instance_id uuid REFERENCES game.entity_instances(instance_id),
  ADD COLUMN IF NOT EXISTS validation_result jsonb,
  ADD COLUMN IF NOT EXISTS installation_result jsonb,
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS generated_content_requests_user_idx
  ON game.generated_content_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS generated_content_requests_definition_idx
  ON game.generated_content_requests(definition_id);

CREATE TABLE IF NOT EXISTS game.installation_evaluations (
  evaluation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES game.generated_content_requests(request_id) ON DELETE CASCADE,
  character_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id),
  residence_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS installation_evaluations_request_idx
  ON game.installation_evaluations(request_id, created_at DESC);

ALTER TABLE system.ai_runs
  ADD COLUMN IF NOT EXISTS output_hash text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
