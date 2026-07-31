-- Authoritative event-driven scheduled work and worker leases.

ALTER TABLE game.scheduled_actions
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS worker_id text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS last_error_code text,
  ADD COLUMN IF NOT EXISTS retryable boolean,
  ADD COLUMN IF NOT EXISTS available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

UPDATE game.scheduled_actions
SET idempotency_key = 'scheduled-action:' || schedule_id::text
WHERE idempotency_key IS NULL;

ALTER TABLE game.scheduled_actions
  ALTER COLUMN idempotency_key SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'scheduled_actions_attempts_check'
      AND conrelid = 'game.scheduled_actions'::regclass
  ) THEN
    ALTER TABLE game.scheduled_actions
      ADD CONSTRAINT scheduled_actions_attempts_check
      CHECK (attempt_count >= 0 AND max_attempts >= 1 AND attempt_count <= max_attempts);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS scheduled_actions_world_idempotency_uq
  ON game.scheduled_actions (world_id, idempotency_key);
CREATE INDEX IF NOT EXISTS scheduled_actions_claim_idx
  ON game.scheduled_actions (
    world_id, shard_id, status, available_at, resolves_at, lease_expires_at
  )
  WHERE status IN ('pending', 'retrying', 'resolving');
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_actions_result_event_uq
  ON game.scheduled_actions (result_event_id)
  WHERE result_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS game.scheduled_action_attempts (
  attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES game.scheduled_actions(schedule_id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  worker_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  status text NOT NULL CHECK (status IN ('running', 'completed', 'retrying', 'failed', 'superseded')),
  error_code text,
  result_event_id uuid REFERENCES game.event_ledger(event_id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (schedule_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS scheduled_action_attempts_schedule_idx
  ON game.scheduled_action_attempts (schedule_id, attempt_number DESC);
