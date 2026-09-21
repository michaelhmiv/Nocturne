-- The starter building and rear alley are explicitly traversable.
-- Containment alone must never be treated as a travel edge.

INSERT INTO game.entity_relations (
  source_instance_id,
  target_instance_id,
  relation_type,
  parameters
)
VALUES (
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000006',
  'adjacent_to',
  jsonb_build_object(
    'connectionType', 'rear_service_exit',
    'travel_time_seconds', 45,
    'bidirectional', true,
    'visibility', 'player_known'
  )
)
ON CONFLICT (source_instance_id, target_instance_id, relation_type)
DO UPDATE SET parameters = EXCLUDED.parameters;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM game.entity_relations route
    WHERE route.source_instance_id = '10000000-0000-4000-8000-000000000004'
      AND route.target_instance_id = '10000000-0000-4000-8000-000000000006'
      AND route.relation_type IN ('adjacent_to', 'accessible_via')
      AND COALESCE((route.parameters->>'bidirectional')::boolean, false) = true
      AND COALESCE(route.parameters->>'visibility', 'player_known') <> 'hidden'
  ) THEN
    RAISE EXCEPTION 'Starter building and rear alley are not connected by a known bidirectional route.';
  END IF;
END;
$$;
