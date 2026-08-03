-- Remove the one-migration compatibility guard installed by 0032z.
-- The permanent append-only trigger remains active throughout and the
-- canonicalization trigger installed by 0033 applies only to future inserts.

DROP TRIGGER IF EXISTS aa_skip_legacy_event_type_rewrite ON game.event_ledger;
DROP FUNCTION IF EXISTS game.skip_legacy_event_type_rewrite();

DROP TRIGGER IF EXISTS event_ledger_canonicalize_type ON game.event_ledger;
CREATE TRIGGER event_ledger_canonicalize_type
BEFORE INSERT ON game.event_ledger
FOR EACH ROW
EXECUTE FUNCTION game.canonicalize_event_type();
