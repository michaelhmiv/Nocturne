-- Migration 0012 attaches an ambient asset pool to Unit 3B. The starter world
-- was historically created lazily by the API, which made a clean migration
-- chain impossible because the referenced residence did not yet exist. Seed
-- the canonical starter geography here, before 0012, using the same stable IDs
-- and semantics as the runtime seed. Existing deployments converge through
-- idempotent inserts without changing applied migration checksums.

INSERT INTO game.entity_definitions (
  definition_id, definition_type, name, concept_summary, origin_source, lifecycle_status
) VALUES
  (
    'WORLD-CALDER-CITY', 'location', 'Calder City',
    'An Atlantic coastal metropolis shaped by old wealth, port crime, advanced research, and hidden supernatural history.',
    'world_seed', 'approved'
  ),
  (
    'WORLD-FOUNDRY-WARD', 'location', 'Foundry Ward',
    'A former industrial district of brick factories, rail infrastructure, workshops, and uneven redevelopment.',
    'world_seed', 'approved'
  ),
  (
    'WORLD-FOUNDRY-ROW', 'location', 'Foundry Row',
    'A dense neighborhood of converted industrial buildings, repair shops, apartments, and active alleys.',
    'world_seed', 'approved'
  ),
  (
    'WORLD-ASHDOWN-APARTMENTS', 'location', 'Ashdown Apartments',
    'A worn but serviceable brick apartment building overlooking Foundry Row.',
    'world_seed', 'approved'
  ),
  (
    'WORLD-ASHDOWN-UNIT-3B', 'residence', 'Ashdown Apartments, Unit 3B',
    'A modest apartment with a spare room, ordinary utilities, and limited concealment for unusual equipment.',
    'world_seed', 'approved'
  ),
  (
    'WORLD-ASHDOWN-REAR-ALLEY', 'location', 'Rear Alley',
    'A service alley behind Ashdown Apartments with dumpsters, fire escapes, delivery access, and inconsistent lighting.',
    'world_seed', 'approved'
  )
ON CONFLICT (definition_id) DO NOTHING;

INSERT INTO game.definition_revisions (
  revision_id, definition_id, schema_version, payload, change_summary
) VALUES
  (
    '20000000-0000-4000-8000-000000000001',
    'WORLD-CALDER-CITY',
    'content-v1',
    '{
      "definitionType":"location",
      "name":"Calder City",
      "conceptSummary":"An Atlantic coastal metropolis shaped by old wealth, port crime, advanced research, and hidden supernatural history.",
      "extensionPayload":{}
    }'::jsonb,
    'Seed Foundry Row starter world'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'WORLD-FOUNDRY-WARD',
    'content-v1',
    '{
      "definitionType":"location",
      "name":"Foundry Ward",
      "conceptSummary":"A former industrial district of brick factories, rail infrastructure, workshops, and uneven redevelopment.",
      "extensionPayload":{}
    }'::jsonb,
    'Seed Foundry Row starter world'
  ),
  (
    '20000000-0000-4000-8000-000000000003',
    'WORLD-FOUNDRY-ROW',
    'content-v1',
    '{
      "definitionType":"location",
      "name":"Foundry Row",
      "conceptSummary":"A dense neighborhood of converted industrial buildings, repair shops, apartments, and active alleys.",
      "extensionPayload":{}
    }'::jsonb,
    'Seed Foundry Row starter world'
  ),
  (
    '20000000-0000-4000-8000-000000000004',
    'WORLD-ASHDOWN-APARTMENTS',
    'content-v1',
    '{
      "definitionType":"location",
      "name":"Ashdown Apartments",
      "conceptSummary":"A worn but serviceable brick apartment building overlooking Foundry Row.",
      "extensionPayload":{}
    }'::jsonb,
    'Seed Foundry Row starter world'
  ),
  (
    '20000000-0000-4000-8000-000000000005',
    'WORLD-ASHDOWN-UNIT-3B',
    'content-v1',
    '{
      "definitionType":"residence",
      "name":"Ashdown Apartments, Unit 3B",
      "conceptSummary":"A modest apartment with a spare room, ordinary utilities, and limited concealment for unusual equipment.",
      "extensionPayload":{"capacities":{"space":3,"power":2,"concealment":1,"security":1,"access":2}}
    }'::jsonb,
    'Seed Foundry Row starter world'
  ),
  (
    '20000000-0000-4000-8000-000000000006',
    'WORLD-ASHDOWN-REAR-ALLEY',
    'content-v1',
    '{
      "definitionType":"location",
      "name":"Rear Alley",
      "conceptSummary":"A service alley behind Ashdown Apartments with dumpsters, fire escapes, delivery access, and inconsistent lighting.",
      "extensionPayload":{}
    }'::jsonb,
    'Seed Foundry Row starter world'
  )
ON CONFLICT (revision_id) DO NOTHING;

UPDATE game.entity_definitions definition
SET current_revision_id = mapping.revision_id,
    updated_at = now()
FROM (
  VALUES
    ('WORLD-CALDER-CITY', '20000000-0000-4000-8000-000000000001'::uuid),
    ('WORLD-FOUNDRY-WARD', '20000000-0000-4000-8000-000000000002'::uuid),
    ('WORLD-FOUNDRY-ROW', '20000000-0000-4000-8000-000000000003'::uuid),
    ('WORLD-ASHDOWN-APARTMENTS', '20000000-0000-4000-8000-000000000004'::uuid),
    ('WORLD-ASHDOWN-UNIT-3B', '20000000-0000-4000-8000-000000000005'::uuid),
    ('WORLD-ASHDOWN-REAR-ALLEY', '20000000-0000-4000-8000-000000000006'::uuid)
) AS mapping(definition_id, revision_id)
WHERE definition.definition_id = mapping.definition_id
  AND definition.current_revision_id IS DISTINCT FROM mapping.revision_id;

INSERT INTO game.entity_instances (
  instance_id, definition_id, location_id, condition, state
) VALUES
  (
    '10000000-0000-4000-8000-000000000001',
    'WORLD-CALDER-CITY',
    NULL,
    100,
    '{}'::jsonb
  ),
  (
    '10000000-0000-4000-8000-000000000002',
    'WORLD-FOUNDRY-WARD',
    '10000000-0000-4000-8000-000000000001',
    100,
    '{}'::jsonb
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    'WORLD-FOUNDRY-ROW',
    '10000000-0000-4000-8000-000000000002',
    100,
    '{}'::jsonb
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    'WORLD-ASHDOWN-APARTMENTS',
    '10000000-0000-4000-8000-000000000003',
    100,
    '{}'::jsonb
  ),
  (
    '10000000-0000-4000-8000-000000000005',
    'WORLD-ASHDOWN-UNIT-3B',
    '10000000-0000-4000-8000-000000000004',
    100,
    '{"rentable":true}'::jsonb
  ),
  (
    '10000000-0000-4000-8000-000000000006',
    'WORLD-ASHDOWN-REAR-ALLEY',
    '10000000-0000-4000-8000-000000000005',
    100,
    '{}'::jsonb
  )
ON CONFLICT (instance_id) DO NOTHING;

INSERT INTO game.entity_relations (
  source_instance_id, target_instance_id, relation_type
) VALUES
  (
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    'located_within'
  ),
  (
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000002',
    'located_within'
  ),
  (
    '10000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000003',
    'located_within'
  ),
  (
    '10000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000004',
    'located_within'
  ),
  (
    '10000000-0000-4000-8000-000000000006',
    '10000000-0000-4000-8000-000000000005',
    'located_within'
  )
ON CONFLICT (source_instance_id, target_instance_id, relation_type) DO NOTHING;

INSERT INTO game.event_ledger (
  event_id, idempotency_key, world_time, event_type, involved_entity_ids, payload
) VALUES (
  '30000000-0000-4000-8000-000000000001',
  'seed:foundry-row:v1',
  now(),
  'starter_world_seeded',
  '[
    "10000000-0000-4000-8000-000000000001",
    "10000000-0000-4000-8000-000000000002",
    "10000000-0000-4000-8000-000000000003",
    "10000000-0000-4000-8000-000000000004",
    "10000000-0000-4000-8000-000000000005",
    "10000000-0000-4000-8000-000000000006"
  ]'::jsonb,
  '{"version":1,"neighborhoodId":"10000000-0000-4000-8000-000000000003"}'::jsonb
)
ON CONFLICT (idempotency_key) DO NOTHING;
