ALTER TABLE game.action_intents
  ADD COLUMN IF NOT EXISTS user_id text,
  ADD COLUMN IF NOT EXISTS method_instance_id uuid REFERENCES game.entity_instances(instance_id),
  ADD COLUMN IF NOT EXISTS target_location_id uuid REFERENCES game.entity_instances(instance_id),
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS action_intents_idempotency_uq ON game.action_intents(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE game.resolution_results
  ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES game.event_ledger(event_id) DEFERRABLE INITIALLY DEFERRED,
  ADD COLUMN IF NOT EXISTS authoritative_seed text,
  ADD COLUMN IF NOT EXISTS actor_score integer,
  ADD COLUMN IF NOT EXISTS target_score integer,
  ADD COLUMN IF NOT EXISTS narration text;
CREATE UNIQUE INDEX IF NOT EXISTS resolution_results_event_uq ON game.resolution_results(event_id) WHERE event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS game.information_assets (
  information_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  subject_instance_id uuid REFERENCES game.entity_instances(instance_id),
  content text NOT NULL,
  confidence numeric(5,4) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  truth_status text NOT NULL CHECK (truth_status IN ('observation', 'inference', 'rumor')),
  source_event_id uuid NOT NULL REFERENCES game.event_ledger(event_id) DEFERRABLE INITIALLY DEFERRED,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS information_assets_holder_idx ON game.information_assets(holder_instance_id, created_at DESC);
CREATE INDEX IF NOT EXISTS information_assets_subject_idx ON game.information_assets(subject_instance_id);
