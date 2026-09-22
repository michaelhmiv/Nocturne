-- Persistent CI worlds need to survive successive GitHub Actions batches.
-- Keep the original short-lived default unchanged for every ordinary inspection
-- and certification run; only explicitly privileged offline provisioning may
-- choose persistent mode. Player-facing APIs never grant this mode.
ALTER TABLE game.certification_runs
  ADD COLUMN campaign_mode text NOT NULL DEFAULT 'ephemeral';

ALTER TABLE game.certification_runs
  DROP CONSTRAINT certification_runs_check;

ALTER TABLE game.certification_runs
  ADD CONSTRAINT certification_runs_expiry_policy CHECK (
    expires_at > created_at
    AND (
      (campaign_mode = 'ephemeral' AND expires_at <= created_at + interval '2 hours')
      OR
      (campaign_mode = 'persistent' AND expires_at <= created_at + interval '90 days')
    )
  );

ALTER TABLE game.certification_runs
  ADD CONSTRAINT certification_runs_campaign_mode_policy CHECK (
    campaign_mode IN ('ephemeral', 'persistent')
  );
