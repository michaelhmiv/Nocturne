CREATE SCHEMA IF NOT EXISTS system;

CREATE TABLE IF NOT EXISTS system.ai_jobs (
  job_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  kind text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  locked_by text,
  result jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT ai_jobs_kind_check CHECK (kind IN ('action_resolution', 'invention_normalization')),
  CONSTRAINT ai_jobs_status_check CHECK (status IN ('pending', 'processing', 'retrying', 'completed', 'failed')),
  CONSTRAINT ai_jobs_attempts_check CHECK (attempts >= 0 AND max_attempts > 0 AND attempts <= max_attempts),
  CONSTRAINT ai_jobs_user_check CHECK (btrim(user_id) <> ''),
  CONSTRAINT ai_jobs_key_check CHECK (btrim(idempotency_key) <> ''),
  CONSTRAINT ai_jobs_hash_check CHECK (btrim(request_hash) <> ''),
  CONSTRAINT ai_jobs_payload_check CHECK (jsonb_typeof(payload) = 'object'),
  CONSTRAINT ai_jobs_result_shape_check CHECK (
    (status IN ('pending', 'processing', 'retrying') AND result IS NULL AND completed_at IS NULL)
    OR (status = 'completed' AND result IS NOT NULL AND error_code IS NULL AND completed_at IS NOT NULL)
    OR (status = 'failed' AND result IS NULL AND error_code IS NOT NULL AND completed_at IS NOT NULL)
  ),
  UNIQUE (user_id, kind, idempotency_key)
);

CREATE INDEX IF NOT EXISTS ai_jobs_due_idx
  ON system.ai_jobs (available_at, created_at)
  WHERE status IN ('pending', 'retrying');

CREATE INDEX IF NOT EXISTS ai_jobs_user_idx
  ON system.ai_jobs (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_jobs_processing_idx
  ON system.ai_jobs (locked_at)
  WHERE status = 'processing';
