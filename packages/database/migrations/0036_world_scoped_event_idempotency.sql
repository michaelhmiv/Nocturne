-- Restore the world-scoped idempotency contract intended by 0013.
--
-- 0000 created game.event_ledger.idempotency_key with an inline UNIQUE
-- constraint, whose backing index is named event_ledger_idempotency_key_key.
-- 0013 added the correct (world_id, idempotency_key) unique index but only
-- dropped the later standalone event_ledger_idempotency_uq index, leaving the
-- original table constraint in place. That silently kept idempotency global.
--
-- Existing data cannot contain cross-world duplicates while the legacy
-- constraint exists, so dropping it before ensuring the scoped index is safe.

ALTER TABLE game.event_ledger
  DROP CONSTRAINT IF EXISTS event_ledger_idempotency_key_key;

DROP INDEX IF EXISTS game.event_ledger_idempotency_uq;

CREATE UNIQUE INDEX IF NOT EXISTS event_ledger_world_idempotency_uq
  ON game.event_ledger (world_id, idempotency_key);
