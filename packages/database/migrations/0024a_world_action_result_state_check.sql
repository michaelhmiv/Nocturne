-- Waiting and clarification responses are player-safe results too; only completed
-- requests require a result unconditionally.

DO $$
DECLARE
  constraint_record record;
BEGIN
  FOR constraint_record IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'game.world_action_requests'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%player_safe_result%'
  LOOP
    EXECUTE format(
      'ALTER TABLE game.world_action_requests DROP CONSTRAINT %I',
      constraint_record.conname
    );
  END LOOP;
END $$;

ALTER TABLE game.world_action_requests
  ADD CONSTRAINT world_action_requests_completed_result_check
  CHECK (status <> 'completed' OR player_safe_result IS NOT NULL);

ALTER TABLE game.world_action_requests
  ADD CONSTRAINT world_action_requests_terminal_time_check
  CHECK (
    (status IN ('completed', 'failed', 'cancelled', 'superseded'))
    = (completed_at IS NOT NULL)
  );
