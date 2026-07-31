-- Activate the persistent-world runtime for the prototype production world.
-- The project currently has no meaningful live player state, so this migration
-- uses a deterministic in-database archive rather than requiring an external
-- cutover command or manual confirmation token.

CREATE SCHEMA IF NOT EXISTS archive_persistent_world_v1_pre_activation;

DO $$
DECLARE
  table_record record;
  archive_table regclass;
BEGIN
  FOR table_record IN
    SELECT DISTINCT table_name
    FROM information_schema.columns
    WHERE table_schema = 'game'
      AND column_name = 'world_id'
    ORDER BY table_name
  LOOP
    IF table_record.table_name !~ '^[a-z_][a-z0-9_]*$' THEN
      RAISE EXCEPTION 'Unsafe game table identifier: %', table_record.table_name;
    END IF;

    archive_table := to_regclass(
      format('archive_persistent_world_v1_pre_activation.%I', table_record.table_name)
    );

    IF archive_table IS NULL THEN
      EXECUTE format(
        'CREATE TABLE archive_persistent_world_v1_pre_activation.%I AS '
        || 'SELECT * FROM game.%I WHERE world_id = $1::uuid',
        table_record.table_name,
        table_record.table_name
      ) USING '00000000-0000-4000-8000-000000000001'::uuid;
    END IF;
  END LOOP;
END $$;

INSERT INTO game.world_state_archives (
  world_id,
  archive_kind,
  database_reference,
  metadata,
  created_by
)
SELECT
  '00000000-0000-4000-8000-000000000001'::uuid,
  'prototype_archive',
  'railway-postgres:archive_persistent_world_v1_pre_activation',
  jsonb_build_object(
    'archiveSchema', 'archive_persistent_world_v1_pre_activation',
    'runtimeVersion', 'persistent-world-v1',
    'activationMigration', '0026_activate_persistent_world_runtime',
    'legacyPreservationRequired', false
  ),
  'system-cutover'
WHERE NOT EXISTS (
  SELECT 1
  FROM game.world_state_archives
  WHERE world_id = '00000000-0000-4000-8000-000000000001'::uuid
    AND database_reference = 'railway-postgres:archive_persistent_world_v1_pre_activation'
);

INSERT INTO game.runtime_features (
  world_id,
  feature_key,
  enabled,
  configuration,
  updated_by,
  updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000001'::uuid,
  'persistent_world_runtime',
  true,
  '{
    "runtimeVersion":"persistent-world-v1",
    "legacyMutationRoutesEnabled":false,
    "severeOfflinePvpEnabled":false,
    "irreversiblePvpEnabled":false,
    "activationSource":"0026_activate_persistent_world_runtime",
    "archiveSchema":"archive_persistent_world_v1_pre_activation"
  }'::jsonb,
  'system-cutover',
  now()
)
ON CONFLICT (world_id, feature_key) DO UPDATE
SET enabled = true,
    configuration = game.runtime_features.configuration || EXCLUDED.configuration,
    updated_by = EXCLUDED.updated_by,
    updated_at = now();

UPDATE game.worlds
SET status = 'active',
    metadata = metadata || '{"persistentWorldRuntime":"persistent-world-v1"}'::jsonb,
    updated_at = now()
WHERE world_id = '00000000-0000-4000-8000-000000000001'::uuid;
