-- Seed a walkable Foundry Row sidewalk and ordinary food-retail place so
-- category destinations like "nearest grocery" can bind without clarification.

INSERT INTO game.entity_definitions (
  definition_id, definition_type, name, concept_summary, origin_source, lifecycle_status
) VALUES
  (
    'WORLD-FOUNDRY-ROW-SIDEWALK', 'location', 'Foundry Row sidewalk',
    'The cracked sidewalk along Foundry Row in front of Ashdown Apartments.',
    'world_seed', 'approved'
  ),
  (
    'WORLD-FOUNDRY-ROW-BODEGA', 'location', 'Row Bodega',
    'A cramped all-hours corner store with a deli case, drinks cooler, and a single clerk.',
    'world_seed', 'approved'
  ),
  (
    'WORLD-ROW-BODEGA-WATER', 'item', 'Bottled water',
    'A cold plastic bottle of water priced for walk-in customers.',
    'world_seed', 'approved'
  ),
  (
    'WORLD-ROW-BODEGA-CLERK', 'npc', 'Row Bodega clerk',
    'The clerk behind the counter at Row Bodega.',
    'world_seed', 'approved'
  )
ON CONFLICT (definition_id) DO NOTHING;

INSERT INTO game.definition_revisions (
  revision_id, definition_id, schema_version, payload, change_summary
) VALUES
  (
    '20000000-0000-4000-8000-000000000007',
    'WORLD-FOUNDRY-ROW-SIDEWALK',
    'content-v1',
    '{"definitionType":"location","name":"Foundry Row sidewalk","conceptSummary":"The cracked sidewalk along Foundry Row in front of Ashdown Apartments.","extensionPayload":{"semanticCategories":["place.street"]}}'::jsonb,
    'Seed Foundry Row retail block'
  ),
  (
    '20000000-0000-4000-8000-000000000008',
    'WORLD-FOUNDRY-ROW-BODEGA',
    'content-v1',
    '{"definitionType":"location","name":"Row Bodega","conceptSummary":"A cramped all-hours corner store with a deli case, drinks cooler, and a single clerk.","extensionPayload":{"semanticCategories":["place.retail.food"]}}'::jsonb,
    'Seed Foundry Row retail block'
  ),
  (
    '20000000-0000-4000-8000-000000000009',
    'WORLD-ROW-BODEGA-WATER',
    'content-v1',
    '{"definitionType":"item","name":"Bottled water","conceptSummary":"A cold plastic bottle of water priced for walk-in customers.","extensionPayload":{"semanticCategories":["item.drink"],"priceCents":150}}'::jsonb,
    'Seed Foundry Row retail block'
  ),
  (
    '20000000-0000-4000-8000-00000000000a',
    'WORLD-ROW-BODEGA-CLERK',
    'content-v1',
    '{"definitionType":"npc","name":"Row Bodega clerk","conceptSummary":"The clerk behind the counter at Row Bodega.","extensionPayload":{"semanticCategories":["actor.vendor"]}}'::jsonb,
    'Seed Foundry Row retail block'
  )
ON CONFLICT (revision_id) DO NOTHING;

UPDATE game.entity_definitions definition
SET current_revision_id = mapping.revision_id,
    updated_at = now()
FROM (
  VALUES
    ('WORLD-FOUNDRY-ROW-SIDEWALK', '20000000-0000-4000-8000-000000000007'::uuid),
    ('WORLD-FOUNDRY-ROW-BODEGA', '20000000-0000-4000-8000-000000000008'::uuid),
    ('WORLD-ROW-BODEGA-WATER', '20000000-0000-4000-8000-000000000009'::uuid),
    ('WORLD-ROW-BODEGA-CLERK', '20000000-0000-4000-8000-00000000000a'::uuid)
) AS mapping(definition_id, revision_id)
WHERE definition.definition_id = mapping.definition_id
  AND definition.current_revision_id IS DISTINCT FROM mapping.revision_id;

INSERT INTO game.entity_instances (
  instance_id, definition_id, location_id, condition, state
) VALUES
  (
    '10000000-0000-4000-8000-000000000007',
    'WORLD-FOUNDRY-ROW-SIDEWALK',
    '10000000-0000-4000-8000-000000000003',
    100,
    '{"semanticCategories":["place.street"]}'::jsonb
  ),
  (
    '10000000-0000-4000-8000-000000000008',
    'WORLD-FOUNDRY-ROW-BODEGA',
    '10000000-0000-4000-8000-000000000007',
    100,
    '{"semanticCategories":["place.retail.food"]}'::jsonb
  ),
  (
    '10000000-0000-4000-8000-000000000009',
    'WORLD-ROW-BODEGA-WATER',
    '10000000-0000-4000-8000-000000000008',
    100,
    '{"semanticCategories":["item.drink"],"priceCents":150,"stock":12}'::jsonb
  ),
  (
    '10000000-0000-4000-8000-00000000000a',
    'WORLD-ROW-BODEGA-CLERK',
    '10000000-0000-4000-8000-000000000008',
    100,
    '{"semanticCategories":["actor.vendor"]}'::jsonb
  )
ON CONFLICT (instance_id) DO NOTHING;

INSERT INTO game.entity_relations (
  source_instance_id, target_instance_id, relation_type
) VALUES
  (
    '10000000-0000-4000-8000-000000000007',
    '10000000-0000-4000-8000-000000000003',
    'located_within'
  ),
  (
    '10000000-0000-4000-8000-000000000008',
    '10000000-0000-4000-8000-000000000007',
    'located_within'
  ),
  (
    '10000000-0000-4000-8000-000000000009',
    '10000000-0000-4000-8000-000000000008',
    'located_within'
  ),
  (
    '10000000-0000-4000-8000-00000000000a',
    '10000000-0000-4000-8000-000000000008',
    'located_within'
  )
ON CONFLICT (source_instance_id, target_instance_id, relation_type) DO NOTHING;

INSERT INTO game.location_profiles (
  location_instance_id,
  world_id,
  shard_id,
  parent_location_id,
  normalized_family,
  semantic_type,
  spatial_cell,
  semantic_fingerprint,
  materialization_status,
  metadata
)
SELECT
  mapping.location_instance_id,
  '00000000-0000-4000-8000-000000000001'::uuid,
  '00000000-0000-4000-8000-000000000002'::uuid,
  mapping.parent_location_id,
  'location',
  'location',
  'legacy:' || mapping.location_instance_id::text,
  mapping.fingerprint,
  'durable',
  '{"seed":"foundry-row-retail-block"}'::jsonb
FROM (
  VALUES
    (
      '10000000-0000-4000-8000-000000000007'::uuid,
      '10000000-0000-4000-8000-000000000003'::uuid,
      'foundry-row-sidewalk'
    ),
    (
      '10000000-0000-4000-8000-000000000008'::uuid,
      '10000000-0000-4000-8000-000000000007'::uuid,
      'foundry-row-bodega'
    )
) AS mapping(location_instance_id, parent_location_id, fingerprint)
ON CONFLICT (location_instance_id) DO NOTHING;
