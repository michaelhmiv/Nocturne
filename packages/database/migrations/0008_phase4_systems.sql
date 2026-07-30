-- Phase 4: scheduled jobs payload, legal, factions, comms, travel edges

ALTER TABLE game.scheduled_actions
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'action',
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Allow craft/jail/move jobs without action_intents FK when intent_id is dummy
-- Keep intent_id nullable for non-action jobs
ALTER TABLE game.scheduled_actions ALTER COLUMN intent_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS game.comms_messages (
  message_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id uuid NOT NULL,
  to_id uuid,
  to_name text NOT NULL DEFAULT '',
  body text NOT NULL,
  intercepted boolean NOT NULL DEFAULT false,
  intercept_chance numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comms_messages_from_idx ON game.comms_messages (from_id, created_at DESC);

-- Minimal travel graph on foundation/world locations (idempotent)
INSERT INTO game.entity_relations (source_instance_id, target_instance_id, relation_type, parameters)
SELECT s, t, 'adjacent_to', jsonb_build_object('travel_time_seconds', secs)
FROM (VALUES
  ('10000000-0000-4000-8000-000000000005'::uuid, '10000000-0000-4000-8000-000000000006'::uuid, 30),  -- unit 3B <-> alley
  ('10000000-0000-4000-8000-000000000006'::uuid, '10000000-0000-4000-8000-000000000004'::uuid, 45),  -- alley <-> ashdown
  ('10000000-0000-4000-8000-000000000004'::uuid, '10000000-0000-4000-8000-000000000003'::uuid, 90),  -- ashdown <-> foundry row
  ('10000000-0000-4000-8000-000000000003'::uuid, '10000000-0000-4000-8000-000000000002'::uuid, 120), -- row <-> ward
  ('10000000-0000-4000-8000-000000000002'::uuid, '10000000-0000-4000-8000-000000000001'::uuid, 180), -- ward <-> city
  ('00000000-0000-4000-8000-000000000002'::uuid, '10000000-0000-4000-8000-000000000006'::uuid, 20)   -- place room <-> alley
) AS e(s,t,secs)
WHERE EXISTS (SELECT 1 FROM game.entity_instances WHERE instance_id = e.s)
  AND EXISTS (SELECT 1 FROM game.entity_instances WHERE instance_id = e.t)
  AND NOT EXISTS (
    SELECT 1 FROM game.entity_relations r
    WHERE r.relation_type = 'adjacent_to'
      AND ((r.source_instance_id = e.s AND r.target_instance_id = e.t)
        OR (r.source_instance_id = e.t AND r.target_instance_id = e.s))
  );

-- Seed faction defs as tags on world (optional standing defaults live on character state)
INSERT INTO game.entity_definitions (definition_id, definition_type, name, concept_summary, origin_source, lifecycle_status)
VALUES
  ('faction-police', 'faction', 'Calder PD', 'Municipal police', 'world-seed', 'approved'),
  ('faction-yakuza', 'faction', 'Harbor Syndicate', 'Organized crime', 'world-seed', 'approved'),
  ('faction-corporate', 'faction', 'Helix Corp', 'Corporate security', 'world-seed', 'approved'),
  ('faction-underground', 'faction', 'The Underground', 'Hackers and fixers', 'world-seed', 'approved')
ON CONFLICT (definition_id) DO NOTHING;
