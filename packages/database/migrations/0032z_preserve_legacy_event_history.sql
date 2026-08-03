-- Compatibility guard for the already-merged 0033 migration.
-- PostgreSQL fires same-kind row triggers in name order. This guard runs before
-- event_ledger_append_only and converts the one legacy label rewrite attempted
-- by 0033 into a no-op, preserving immutable historical events.

CREATE OR REPLACE FUNCTION game.skip_legacy_event_type_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.event_type = 'world_mutation'
     AND NEW.event_type = 'world_state_mutated' THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aa_skip_legacy_event_type_rewrite ON game.event_ledger;
CREATE TRIGGER aa_skip_legacy_event_type_rewrite
BEFORE UPDATE OF event_type ON game.event_ledger
FOR EACH ROW
EXECUTE FUNCTION game.skip_legacy_event_type_rewrite();
