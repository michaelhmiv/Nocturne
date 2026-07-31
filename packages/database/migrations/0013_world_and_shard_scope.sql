-- Persistent shared-world and shard scope.
-- Prototype compatibility migration: install defaults before backfills and avoid
-- table-altering DDL after row updates in the same transaction.

CREATE TABLE IF NOT EXISTS game.worlds (
  world_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('provisioning', 'active', 'maintenance', 'archived')),
  clock_mode text NOT NULL DEFAULT 'realtime'
    CHECK (clock_mode IN ('realtime')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game.world_shards (
  shard_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('provisioning', 'active', 'draining', 'archived')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, slug),
  UNIQUE (world_id, shard_id)
);

CREATE TABLE IF NOT EXISTS game.world_memberships (
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  role text NOT NULL DEFAULT 'player'
    CHECK (role IN ('player', 'moderator', 'operator', 'owner')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('invited', 'active', 'suspended', 'left')),
  selected_character_id uuid,
  joined_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, user_id)
);

CREATE INDEX IF NOT EXISTS world_memberships_user_idx
  ON game.world_memberships (user_id, status, joined_at DESC);

INSERT INTO game.worlds (
  world_id, slug, name, status, clock_mode, metadata
) VALUES (
  '00000000-0000-4000-8000-000000000001',
  'nocturne',
  'Nocturne',
  'active',
  'realtime',
  '{"launchMode":"single-shared-world","source":"0013_world_and_shard_scope"}'::jsonb
) ON CONFLICT (world_id) DO NOTHING;

INSERT INTO game.world_shards (
  shard_id, world_id, slug, name, status, metadata
) VALUES (
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000001',
  'primary',
  'Primary',
  'active',
  '{"launchShard":true}'::jsonb
) ON CONFLICT (shard_id) DO NOTHING;

ALTER TABLE IF EXISTS game.entity_definitions
  ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES game.worlds(world_id);
ALTER TABLE IF EXISTS game.definition_revisions
  ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES game.worlds(world_id);
ALTER TABLE IF EXISTS game.entity_instances
  ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES game.worlds(world_id),
  ADD COLUMN IF NOT EXISTS shard_id uuid REFERENCES game.world_shards(shard_id);
ALTER TABLE IF EXISTS game.player_characters
  ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES game.worlds(world_id);
ALTER TABLE IF EXISTS game.entity_relations
  ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES game.worlds(world_id);
ALTER TABLE IF EXISTS game.residence_occupancies
  ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES game.worlds(world_id);
ALTER TABLE IF EXISTS game.generated_content_requests
  ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES game.worlds(world_id);
ALTER TABLE IF EXISTS game.installation_evaluations
  ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES game.worlds(world_id);
ALTER TABLE IF EXISTS game.action_intents
  ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES game.worlds(world_id),
  ADD COLUMN IF NOT EXISTS shard_id uuid REFERENCES game.world_shards(shard_id);
ALTER TABLE IF EXISTS game.event_ledger
  ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES game.worlds(world_id),
  ADD COLUMN IF NOT EXISTS shard_id uuid REFERENCES game.world_shards(shard_id);
ALTER TABLE IF EXISTS game.resolution_results
  ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES game.worlds(world_id);
ALTER TABLE IF EXISTS game.information_assets
  ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES game.worlds(world_id);
ALTER TABLE IF EXISTS game.conversations
  ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES game.worlds(world_id);
ALTER TABLE IF EXISTS game.conversation_turns
  ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES game.worlds(world_id);
ALTER TABLE IF EXISTS game.scheduled_actions
  ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES game.worlds(world_id),
  ADD COLUMN IF NOT EXISTS shard_id uuid REFERENCES game.world_shards(shard_id);
ALTER TABLE IF EXISTS game.entity_semantic_profiles
  ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES game.worlds(world_id);
ALTER TABLE IF EXISTS game.ambient_asset_pools
  ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES game.worlds(world_id);

ALTER TABLE IF EXISTS system.ai_jobs
  ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES game.worlds(world_id),
  ADD COLUMN IF NOT EXISTS shard_id uuid REFERENCES game.world_shards(shard_id);
ALTER TABLE IF EXISTS system.ai_runs
  ADD COLUMN IF NOT EXISTS world_id uuid REFERENCES game.worlds(world_id),
  ADD COLUMN IF NOT EXISTS shard_id uuid REFERENCES game.world_shards(shard_id);

-- Install defaults before any updates. We intentionally leave legacy columns
-- nullable in this compatibility migration; defaults plus runtime scope checks
-- govern all new rows, and a later clean-world migration can validate NOT NULL.
DO $$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'entity_definitions',
    'definition_revisions',
    'entity_instances',
    'player_characters',
    'entity_relations',
    'residence_occupancies',
    'generated_content_requests',
    'installation_evaluations',
    'action_intents',
    'event_ledger',
    'resolution_results',
    'information_assets',
    'conversations',
    'conversation_turns',
    'scheduled_actions',
    'entity_semantic_profiles',
    'ambient_asset_pools'
  ] LOOP
    IF to_regclass('game.' || relation_name) IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE game.%I ALTER COLUMN world_id SET DEFAULT %L::uuid',
        relation_name,
        '00000000-0000-4000-8000-000000000001'
      );
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('game.entity_instances') IS NOT NULL THEN
    ALTER TABLE game.entity_instances
      ALTER COLUMN shard_id SET DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
  END IF;
  IF to_regclass('game.action_intents') IS NOT NULL THEN
    ALTER TABLE game.action_intents
      ALTER COLUMN shard_id SET DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
  END IF;
  IF to_regclass('game.event_ledger') IS NOT NULL THEN
    ALTER TABLE game.event_ledger
      ALTER COLUMN shard_id SET DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
  END IF;
  IF to_regclass('game.scheduled_actions') IS NOT NULL THEN
    ALTER TABLE game.scheduled_actions
      ALTER COLUMN shard_id SET DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
  END IF;
  IF to_regclass('system.ai_jobs') IS NOT NULL THEN
    ALTER TABLE system.ai_jobs
      ALTER COLUMN world_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
      ALTER COLUMN shard_id SET DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
  END IF;
  IF to_regclass('system.ai_runs') IS NOT NULL THEN
    ALTER TABLE system.ai_runs
      ALTER COLUMN world_id SET DEFAULT '00000000-0000-4000-8000-000000000001'::uuid,
      ALTER COLUMN shard_id SET DEFAULT '00000000-0000-4000-8000-000000000002'::uuid;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'world_memberships_selected_character_fk'
      AND conrelid = 'game.world_memberships'::regclass
  ) THEN
    ALTER TABLE game.world_memberships
      ADD CONSTRAINT world_memberships_selected_character_fk
      FOREIGN KEY (selected_character_id)
      REFERENCES game.entity_instances(instance_id)
      ON DELETE SET NULL;
  END IF;
END $$;

DROP INDEX IF EXISTS game.action_intents_idempotency_uq;
CREATE UNIQUE INDEX IF NOT EXISTS action_intents_world_idempotency_uq
  ON game.action_intents (world_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

DROP INDEX IF EXISTS game.event_ledger_idempotency_uq;
CREATE UNIQUE INDEX IF NOT EXISTS event_ledger_world_idempotency_uq
  ON game.event_ledger (world_id, idempotency_key);

CREATE INDEX IF NOT EXISTS entity_instances_world_location_idx
  ON game.entity_instances (world_id, shard_id, location_id);
CREATE INDEX IF NOT EXISTS entity_relations_world_source_idx
  ON game.entity_relations (world_id, source_instance_id, relation_type);
CREATE INDEX IF NOT EXISTS event_ledger_world_time_scope_idx
  ON game.event_ledger (world_id, shard_id, world_time DESC);

-- Backfill append-only and ordinary tables without firing user triggers.
DO $$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'entity_definitions',
    'definition_revisions',
    'entity_instances',
    'player_characters',
    'entity_relations',
    'residence_occupancies',
    'generated_content_requests',
    'installation_evaluations',
    'action_intents',
    'event_ledger',
    'resolution_results',
    'information_assets',
    'conversations',
    'conversation_turns',
    'scheduled_actions',
    'entity_semantic_profiles',
    'ambient_asset_pools'
  ] LOOP
    IF to_regclass('game.' || relation_name) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE game.%I DISABLE TRIGGER USER', relation_name);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'entity_definitions',
    'definition_revisions',
    'entity_instances',
    'player_characters',
    'entity_relations',
    'residence_occupancies',
    'generated_content_requests',
    'installation_evaluations',
    'action_intents',
    'event_ledger',
    'resolution_results',
    'information_assets',
    'conversations',
    'conversation_turns',
    'scheduled_actions',
    'entity_semantic_profiles',
    'ambient_asset_pools'
  ] LOOP
    IF to_regclass('game.' || relation_name) IS NOT NULL THEN
      EXECUTE format(
        'UPDATE game.%I SET world_id = $1 WHERE world_id IS NULL',
        relation_name
      ) USING '00000000-0000-4000-8000-000000000001'::uuid;
    END IF;
  END LOOP;
END $$;

UPDATE game.entity_instances
SET shard_id = '00000000-0000-4000-8000-000000000002'
WHERE shard_id IS NULL;

UPDATE game.action_intents
SET shard_id = '00000000-0000-4000-8000-000000000002'
WHERE shard_id IS NULL;

UPDATE game.event_ledger
SET shard_id = '00000000-0000-4000-8000-000000000002'
WHERE shard_id IS NULL;

DO $$
BEGIN
  IF to_regclass('game.scheduled_actions') IS NOT NULL THEN
    UPDATE game.scheduled_actions
    SET shard_id = '00000000-0000-4000-8000-000000000002'
    WHERE shard_id IS NULL;
  END IF;
  IF to_regclass('system.ai_jobs') IS NOT NULL THEN
    UPDATE system.ai_jobs
    SET world_id = COALESCE(world_id, '00000000-0000-4000-8000-000000000001'::uuid),
        shard_id = COALESCE(shard_id, '00000000-0000-4000-8000-000000000002'::uuid)
    WHERE world_id IS NULL OR shard_id IS NULL;
  END IF;
  IF to_regclass('system.ai_runs') IS NOT NULL THEN
    UPDATE system.ai_runs
    SET world_id = COALESCE(world_id, '00000000-0000-4000-8000-000000000001'::uuid),
        shard_id = COALESCE(shard_id, '00000000-0000-4000-8000-000000000002'::uuid)
    WHERE world_id IS NULL OR shard_id IS NULL;
  END IF;
END $$;

INSERT INTO game.world_memberships (world_id, user_id, role, status)
SELECT
  '00000000-0000-4000-8000-000000000001'::uuid,
  users.user_id,
  'player',
  'active'
FROM (
  SELECT DISTINCT user_id FROM game.player_characters
  UNION
  SELECT DISTINCT user_id FROM game.conversations
) users
WHERE btrim(users.user_id) <> ''
ON CONFLICT (world_id, user_id) DO NOTHING;

UPDATE game.world_memberships membership
SET selected_character_id = selected.character_instance_id,
    updated_at = now()
FROM game.player_characters selected
WHERE membership.world_id = selected.world_id
  AND membership.user_id = selected.user_id
  AND selected.selected
  AND membership.selected_character_id IS NULL;

DO $$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'entity_definitions',
    'definition_revisions',
    'entity_instances',
    'player_characters',
    'entity_relations',
    'residence_occupancies',
    'generated_content_requests',
    'installation_evaluations',
    'action_intents',
    'event_ledger',
    'resolution_results',
    'information_assets',
    'conversations',
    'conversation_turns',
    'scheduled_actions',
    'entity_semantic_profiles',
    'ambient_asset_pools'
  ] LOOP
    IF to_regclass('game.' || relation_name) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE game.%I ENABLE TRIGGER USER', relation_name);
    END IF;
  END LOOP;
END $$;
