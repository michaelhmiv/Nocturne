-- Event ledger rows are append-only. A legacy scope-propagation trigger updates
-- a newly inserted ledger row after another scoped row is inserted, which now
-- conflicts with the append-only enforcement trigger. World/shard defaults and
-- explicitly scoped universal-operation inserts make that post-insert mutation
-- unnecessary in the launch world.
--
-- Drop only triggers whose function body performs the invalid event-ledger
-- UPDATE. Materialize actual trigger functions before calling
-- pg_get_functiondef so PostgreSQL cannot reorder evaluation across aggregate
-- pg_proc rows such as array_agg.

DO $$
DECLARE
  trigger_record record;
BEGIN
  FOR trigger_record IN
    WITH candidate_triggers AS MATERIALIZED (
      SELECT
        trigger.oid AS trigger_oid,
        namespace.nspname AS table_schema,
        relation.relname AS table_name,
        trigger.tgname AS trigger_name,
        function_namespace.nspname AS function_schema,
        function.proname AS function_name,
        function.oid AS function_oid,
        pg_get_functiondef(trigger.tgfoid) AS function_definition
      FROM pg_trigger trigger
      JOIN pg_class relation
        ON relation.oid = trigger.tgrelid
      JOIN pg_namespace namespace
        ON namespace.oid = relation.relnamespace
      JOIN pg_proc function
        ON function.oid = trigger.tgfoid
       AND function.prokind = 'f'
      JOIN pg_namespace function_namespace
        ON function_namespace.oid = function.pronamespace
      WHERE NOT trigger.tgisinternal
    )
    SELECT *
    FROM candidate_triggers
    WHERE function_definition ILIKE '%UPDATE game.event_ledger%'
      AND function_definition ILIKE '%world_id = NEW.world_id%'
      AND function_definition ILIKE '%shard_id = NEW.shard_id%'
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS %I ON %I.%I',
      trigger_record.trigger_name,
      trigger_record.table_schema,
      trigger_record.table_name
    );

    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger remaining
      WHERE remaining.tgfoid = trigger_record.function_oid
        AND NOT remaining.tgisinternal
    ) THEN
      EXECUTE format(
        'DROP FUNCTION IF EXISTS %I.%I()',
        trigger_record.function_schema,
        trigger_record.function_name
      );
    END IF;
  END LOOP;
END $$;

ALTER TABLE game.event_ledger
  ALTER COLUMN world_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
  ALTER COLUMN shard_id SET DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;

-- Assert that no user trigger can still perform the forbidden self-update.
DO $$
BEGIN
  IF EXISTS (
    WITH candidate_triggers AS MATERIALIZED (
      SELECT pg_get_functiondef(trigger.tgfoid) AS function_definition
      FROM pg_trigger trigger
      JOIN pg_proc function
        ON function.oid = trigger.tgfoid
       AND function.prokind = 'f'
      WHERE NOT trigger.tgisinternal
    )
    SELECT 1
    FROM candidate_triggers
    WHERE function_definition ILIKE '%UPDATE game.event_ledger%'
      AND function_definition ILIKE '%world_id = NEW.world_id%'
      AND function_definition ILIKE '%shard_id = NEW.shard_id%'
  ) THEN
    RAISE EXCEPTION 'Invalid post-insert event-ledger scope mutation trigger remains installed';
  END IF;
END $$;
