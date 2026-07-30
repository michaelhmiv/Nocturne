CREATE SCHEMA IF NOT EXISTS system;

CREATE TABLE IF NOT EXISTS system.worker_heartbeats (
  worker_id text PRIMARY KEY,
  role text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT worker_heartbeats_worker_id_check CHECK (btrim(worker_id) <> ''),
  CONSTRAINT worker_heartbeats_role_check CHECK (btrim(role) <> ''),
  CONSTRAINT worker_heartbeats_metadata_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS worker_heartbeats_role_seen_idx
  ON system.worker_heartbeats (role, last_seen_at DESC);
