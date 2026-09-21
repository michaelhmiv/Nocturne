-- Explicit server-side binding between an authenticated account and exactly one
-- isolated certification run. A user-provided email, header or world ID is NOT
-- proof of authorization. Only a privileged, offline provisioning transaction
-- may insert a binding.
ALTER TABLE game.certification_runs
  ADD CONSTRAINT certification_runs_scope_uq
  UNIQUE (run_id, world_id, shard_id);

CREATE TABLE game.certification_players (
  run_id uuid NOT NULL,
  user_id text NOT NULL UNIQUE CHECK (btrim(user_id) <> ''),
  world_id uuid NOT NULL,
  shard_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, user_id),
  FOREIGN KEY (run_id, world_id, shard_id)
    REFERENCES game.certification_runs(run_id, world_id, shard_id)
    ON DELETE CASCADE
);

CREATE INDEX certification_players_run_idx
  ON game.certification_players(run_id, created_at);
