-- Restore user triggers after the world/shard backfill commits. This must remain
-- a separate migration transaction so PostgreSQL has cleared deferred trigger
-- events before ALTER TABLE re-enables append-only enforcement.

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
