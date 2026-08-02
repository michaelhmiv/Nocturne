CREATE TABLE IF NOT EXISTS game.building_unit_counters (
  building_instance_id uuid PRIMARY KEY REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  next_unit_number bigint NOT NULL DEFAULT 1 CHECK (next_unit_number > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO game.building_unit_counters (building_instance_id, next_unit_number)
VALUES ('10000000-0000-4000-8000-000000000004', 1)
ON CONFLICT (building_instance_id) DO NOTHING;

UPDATE game.entity_instances
SET state = COALESCE(state, '{}'::jsonb) || jsonb_build_object(
  'housingType', 'starter_apartment',
  'housingTier', 'bare_bones',
  'buildingId', '10000000-0000-4000-8000-000000000004',
  'unitLabel', '3B',
  'privateInterior', true,
  'capacities', jsonb_build_object(
    'space', 1,
    'power', 1,
    'concealment', 0,
    'security', 0,
    'access', 1,
    'comfort', 1
  )
)
WHERE instance_id = '10000000-0000-4000-8000-000000000005';

UPDATE game.definition_revisions r
SET payload = jsonb_set(
  r.payload,
  '{extensionPayload,capacities}',
  jsonb_build_object(
    'space', 1,
    'power', 1,
    'concealment', 0,
    'security', 0,
    'access', 1,
    'comfort', 1
  ),
  true
)
FROM game.entity_definitions d
WHERE d.definition_id = 'WORLD-ASHDOWN-UNIT-3B'
  AND d.current_revision_id = r.revision_id;

CREATE UNIQUE INDEX IF NOT EXISTS entity_instances_starter_unit_label_uq
  ON game.entity_instances(location_id, (state->>'unitLabel'))
  WHERE state->>'housingType' = 'starter_apartment';

CREATE OR REPLACE FUNCTION game.provision_starter_residence(
  p_user_id text,
  p_character_id uuid,
  p_idempotency_key text
)
RETURNS TABLE (
  residence_id uuid,
  event_id uuid,
  already_rented boolean
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing_residence_id uuid;
  v_event_id uuid;
  v_unit_number bigint;
  v_floor integer;
  v_letter text;
  v_unit_label text;
  v_residence_name text;
  v_definition_id text;
  v_revision_id uuid;
  v_residence_id uuid;
  v_capacities jsonb := jsonb_build_object(
    'space', 1,
    'power', 1,
    'concealment', 0,
    'security', 0,
    'access', 1,
    'comfort', 1
  );
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM game.player_characters pc
    WHERE pc.user_id = p_user_id
      AND pc.character_instance_id = p_character_id
  ) THEN
    RAISE EXCEPTION 'Character is not controlled by this account.' USING ERRCODE = '42501';
  END IF;

  SELECT o.residence_instance_id
  INTO v_existing_residence_id
  FROM game.residence_occupancies o
  WHERE o.character_instance_id = p_character_id
    AND o.status = 'active'
  LIMIT 1;

  IF v_existing_residence_id IS NOT NULL THEN
    SELECT e.event_id
    INTO v_event_id
    FROM game.event_ledger e
    WHERE e.event_type IN ('starter_residence_provisioned', 'residence_rented')
      AND e.payload->>'characterId' = p_character_id::text
    ORDER BY e.created_at DESC
    LIMIT 1;

    IF v_event_id IS NULL THEN
      v_event_id := gen_random_uuid();
      INSERT INTO game.event_ledger (
        event_id,
        idempotency_key,
        world_time,
        event_type,
        involved_entity_ids,
        payload
      ) VALUES (
        v_event_id,
        p_idempotency_key,
        now(),
        'starter_residence_provisioned',
        jsonb_build_array(p_character_id, v_existing_residence_id),
        jsonb_build_object(
          'eventId', v_event_id,
          'characterId', p_character_id,
          'residenceId', v_existing_residence_id,
          'userId', p_user_id,
          'recoveredExistingOccupancy', true
        )
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN QUERY SELECT v_existing_residence_id, v_event_id, true;
    RETURN;
  END IF;

  SELECT e.event_id,
         (e.payload->>'residenceId')::uuid
  INTO v_event_id, v_existing_residence_id
  FROM game.event_ledger e
  WHERE e.idempotency_key = p_idempotency_key
    AND e.event_type = 'starter_residence_provisioned'
  LIMIT 1;

  IF v_existing_residence_id IS NOT NULL THEN
    RETURN QUERY SELECT v_existing_residence_id, v_event_id, true;
    RETURN;
  END IF;

  INSERT INTO game.building_unit_counters (building_instance_id, next_unit_number)
  VALUES ('10000000-0000-4000-8000-000000000004', 1)
  ON CONFLICT (building_instance_id) DO NOTHING;

  UPDATE game.building_unit_counters
  SET next_unit_number = next_unit_number + 1,
      updated_at = now()
  WHERE building_instance_id = '10000000-0000-4000-8000-000000000004'
  RETURNING next_unit_number - 1 INTO v_unit_number;

  v_floor := 2 + ((v_unit_number - 1) / 8)::integer;
  v_letter := chr(65 + ((v_unit_number - 1) % 8)::integer);
  v_unit_label := v_floor::text || v_letter;
  v_residence_name := 'Ashdown Apartments, Unit ' || v_unit_label;
  v_definition_id := 'RESIDENCE-ASHDOWN-' || gen_random_uuid()::text;
  v_revision_id := gen_random_uuid();
  v_residence_id := gen_random_uuid();
  v_event_id := gen_random_uuid();

  INSERT INTO game.entity_definitions (
    definition_id,
    definition_type,
    name,
    concept_summary,
    origin_source,
    lifecycle_status
  ) VALUES (
    v_definition_id,
    'residence',
    v_residence_name,
    'A cramped, low-rent apartment in Ashdown Apartments. It has basic utilities, weak locks, almost no concealment, and little room for serious equipment.',
    'starter_housing_allocator',
    'approved'
  );

  INSERT INTO game.definition_revisions (
    revision_id,
    definition_id,
    schema_version,
    payload,
    change_summary
  ) VALUES (
    v_revision_id,
    v_definition_id,
    'content-v1',
    jsonb_build_object(
      'definitionType', 'residence',
      'name', v_residence_name,
      'conceptSummary', 'A cramped, low-rent apartment in Ashdown Apartments with basic utilities, weak locks, and almost no room for unusual equipment.',
      'extensionPayload', jsonb_build_object(
        'capacities', v_capacities,
        'housing', jsonb_build_object(
          'tier', 'bare_bones',
          'buildingId', '10000000-0000-4000-8000-000000000004',
          'unitLabel', v_unit_label,
          'upgradePressure', 'high'
        )
      )
    ),
    'Provision unique starter apartment'
  );

  UPDATE game.entity_definitions
  SET current_revision_id = v_revision_id,
      updated_at = now()
  WHERE definition_id = v_definition_id;

  INSERT INTO game.entity_instances (
    instance_id,
    definition_id,
    location_id,
    condition,
    state
  ) VALUES (
    v_residence_id,
    v_definition_id,
    '10000000-0000-4000-8000-000000000004',
    72,
    jsonb_build_object(
      'housingType', 'starter_apartment',
      'housingTier', 'bare_bones',
      'buildingId', '10000000-0000-4000-8000-000000000004',
      'unitLabel', v_unit_label,
      'privateInterior', true,
      'rentCents', 0,
      'capacities', v_capacities,
      'upgradePressure', 'high'
    )
  );

  INSERT INTO game.entity_relations (
    source_instance_id,
    target_instance_id,
    relation_type,
    parameters
  ) VALUES (
    v_residence_id,
    '10000000-0000-4000-8000-000000000004',
    'located_within',
    jsonb_build_object('unitLabel', v_unit_label, 'floor', v_floor)
  ) ON CONFLICT (source_instance_id, target_instance_id, relation_type) DO NOTHING;

  INSERT INTO game.residence_occupancies (
    residence_instance_id,
    character_instance_id,
    user_id,
    status
  ) VALUES (
    v_residence_id,
    p_character_id,
    p_user_id,
    'active'
  );

  INSERT INTO game.entity_relations (
    source_instance_id,
    target_instance_id,
    relation_type,
    parameters
  ) VALUES (
    p_character_id,
    v_residence_id,
    'occupies',
    jsonb_build_object('role', 'tenant', 'starter', true)
  ) ON CONFLICT (source_instance_id, target_instance_id, relation_type) DO NOTHING;

  UPDATE game.entity_instances
  SET location_id = v_residence_id,
      updated_at = now()
  WHERE instance_id = p_character_id;

  INSERT INTO game.event_ledger (
    event_id,
    idempotency_key,
    world_time,
    event_type,
    involved_entity_ids,
    payload
  ) VALUES (
    v_event_id,
    p_idempotency_key,
    now(),
    'starter_residence_provisioned',
    jsonb_build_array(p_character_id, v_residence_id, '10000000-0000-4000-8000-000000000004'::uuid),
    jsonb_build_object(
      'eventId', v_event_id,
      'characterId', p_character_id,
      'residenceId', v_residence_id,
      'buildingId', '10000000-0000-4000-8000-000000000004',
      'unitLabel', v_unit_label,
      'housingTier', 'bare_bones',
      'userId', p_user_id
    )
  );

  RETURN QUERY SELECT v_residence_id, v_event_id, false;
END;
$$;

DO $$
DECLARE
  character_row record;
BEGIN
  FOR character_row IN
    SELECT pc.user_id, pc.character_instance_id
    FROM game.player_characters pc
    LEFT JOIN game.residence_occupancies o
      ON o.character_instance_id = pc.character_instance_id
      AND o.status = 'active'
    WHERE o.residence_instance_id IS NULL
    ORDER BY pc.created_at, pc.character_instance_id
  LOOP
    PERFORM *
    FROM game.provision_starter_residence(
      character_row.user_id,
      character_row.character_instance_id,
      'starter-residence:' || character_row.character_instance_id::text
    );
  END LOOP;
END;
$$;
