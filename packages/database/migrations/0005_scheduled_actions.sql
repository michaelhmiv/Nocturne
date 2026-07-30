-- ponytail: minimal scheduled-actions table for real-time resolution.
-- Actions with duration > 0 create a row here. Worker polls and resolves.

CREATE TABLE IF NOT EXISTS game.scheduled_actions (
  schedule_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id     uuid NOT NULL REFERENCES game.action_intents(intent_id) ON DELETE CASCADE,
  resolves_at   timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'resolving', 'resolved', 'failed')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduled_actions_due_idx
  ON game.scheduled_actions (status, resolves_at)
  WHERE status = 'pending';
