-- Canonical authoritative event semantics.
-- Existing universal mutation callers retain compatibility while new non-mutating
-- action events use explicit types and do not change entity versions.

UPDATE game.event_ledger
SET event_type = 'world_state_mutated'
WHERE event_type = 'world_mutation';

CREATE OR REPLACE FUNCTION game.canonicalize_event_type()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.event_type = 'world_mutation' THEN
    NEW.event_type := 'world_state_mutated';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_ledger_canonicalize_type ON game.event_ledger;
CREATE TRIGGER event_ledger_canonicalize_type
BEFORE INSERT OR UPDATE OF event_type ON game.event_ledger
FOR EACH ROW
EXECUTE FUNCTION game.canonicalize_event_type();

CREATE INDEX IF NOT EXISTS event_ledger_typed_event_idx
  ON game.event_ledger(world_id, shard_id, event_type, created_at DESC);
