-- Every starter apartment must have a traversable apartment-door edge to its
-- containing building. `located_within` remains the containment relationship;
-- movement uses `accessible_via` and `adjacent_to` edges.

CREATE OR REPLACE FUNCTION game.ensure_starter_residence_route()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_building_id uuid;
BEGIN
  IF COALESCE(NEW.state->>'housingType', '') <> 'starter_apartment' THEN
    RETURN NEW;
  END IF;

  v_building_id := COALESCE(
    NULLIF(NEW.state->>'buildingId', '')::uuid,
    NEW.location_id
  );
  IF v_building_id IS NULL THEN
    RAISE EXCEPTION 'Starter residence % has no containing building.', NEW.instance_id
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO game.entity_relations (
    source_instance_id,
    target_instance_id,
    relation_type,
    parameters
  )
  VALUES (
    NEW.instance_id,
    v_building_id,
    'accessible_via',
    jsonb_build_object(
      'connectionType', 'apartment_door',
      'travel_time_seconds', 20,
      'bidirectional', true,
      'privateInterior', true,
      'unitLabel', NEW.state->>'unitLabel'
    )
  )
  ON CONFLICT (source_instance_id, target_instance_id, relation_type)
  DO UPDATE SET parameters = EXCLUDED.parameters;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS entity_instances_starter_residence_route ON game.entity_instances;
CREATE TRIGGER entity_instances_starter_residence_route
AFTER INSERT OR UPDATE OF state, location_id ON game.entity_instances
FOR EACH ROW
WHEN (NEW.state->>'housingType' = 'starter_apartment')
EXECUTE FUNCTION game.ensure_starter_residence_route();

INSERT INTO game.entity_relations (
  source_instance_id,
  target_instance_id,
  relation_type,
  parameters
)
SELECT
  residence.instance_id,
  COALESCE(
    NULLIF(residence.state->>'buildingId', '')::uuid,
    residence.location_id
  ),
  'accessible_via',
  jsonb_build_object(
    'connectionType', 'apartment_door',
    'travel_time_seconds', 20,
    'bidirectional', true,
    'privateInterior', true,
    'unitLabel', residence.state->>'unitLabel'
  )
FROM game.entity_instances residence
WHERE residence.state->>'housingType' = 'starter_apartment'
  AND COALESCE(NULLIF(residence.state->>'buildingId', '')::uuid, residence.location_id) IS NOT NULL
ON CONFLICT (source_instance_id, target_instance_id, relation_type)
DO UPDATE SET parameters = EXCLUDED.parameters;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM game.entity_instances residence
    WHERE residence.state->>'housingType' = 'starter_apartment'
      AND NOT EXISTS (
        SELECT 1
        FROM game.entity_relations route
        WHERE route.source_instance_id = residence.instance_id
          AND route.target_instance_id = COALESCE(
            NULLIF(residence.state->>'buildingId', '')::uuid,
            residence.location_id
          )
          AND route.relation_type = 'accessible_via'
      )
  ) THEN
    RAISE EXCEPTION 'One or more starter residences remain disconnected from the route graph.';
  END IF;
END;
$$;
