-- Reconcile the monotonic Ashdown Apartments unit allocator with every
-- starter-unit label already present in the authoritative instance table.
--
-- Migration 0012 intentionally preserved the legacy Unit 3B, but initialized
-- the new allocator at Unit 2A. Once the counter advanced to ordinal 10 it
-- attempted to allocate 3B again and hit the unique unit-label invariant.
-- Advancing the counter beyond the highest occupied generated label preserves
-- atomic allocation while permanently skipping all pre-existing units.

WITH occupied_units AS (
  SELECT MAX(
    ((substring(state->>'unitLabel' FROM '^([0-9]+)')::bigint - 2) * 8)
    + (ascii(right(state->>'unitLabel', 1)) - ascii('A'))
    + 1
  ) AS highest_ordinal
  FROM game.entity_instances
  WHERE location_id = '10000000-0000-4000-8000-000000000004'
    AND state->>'housingType' = 'starter_apartment'
    AND state->>'unitLabel' ~ '^[0-9]+[A-H]$'
)
UPDATE game.building_unit_counters AS counter
SET next_unit_number = GREATEST(
      counter.next_unit_number,
      COALESCE(occupied_units.highest_ordinal, 0) + 1
    ),
    updated_at = now()
FROM occupied_units
WHERE counter.building_instance_id = '10000000-0000-4000-8000-000000000004';

DO $$
DECLARE
  v_counter bigint;
  v_highest bigint;
BEGIN
  SELECT next_unit_number
  INTO v_counter
  FROM game.building_unit_counters
  WHERE building_instance_id = '10000000-0000-4000-8000-000000000004';

  SELECT MAX(
    ((substring(state->>'unitLabel' FROM '^([0-9]+)')::bigint - 2) * 8)
    + (ascii(right(state->>'unitLabel', 1)) - ascii('A'))
    + 1
  )
  INTO v_highest
  FROM game.entity_instances
  WHERE location_id = '10000000-0000-4000-8000-000000000004'
    AND state->>'housingType' = 'starter_apartment'
    AND state->>'unitLabel' ~ '^[0-9]+[A-H]$';

  IF v_counter IS NULL THEN
    RAISE EXCEPTION 'Ashdown Apartments unit counter is missing.';
  END IF;

  IF v_counter <= COALESCE(v_highest, 0) THEN
    RAISE EXCEPTION
      'Ashdown Apartments unit counter % does not exceed highest occupied ordinal %.',
      v_counter,
      COALESCE(v_highest, 0);
  END IF;
END;
$$;
