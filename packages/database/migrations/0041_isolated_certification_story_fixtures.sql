-- Offline-only fixture functions. Never expose these as ordinary API or MCP tools.
-- World/shard and membership are read from the authoritative run, never from a
-- caller-supplied player world ID. This is intentionally a small original
-- fictional district, not a substitute for the complete NYC map importer.
CREATE OR REPLACE FUNCTION game.provision_certification_district(p_run_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_run record;
  v_ids jsonb;
  v_city uuid := gen_random_uuid();
  v_district uuid := gen_random_uuid();
  v_neighborhood uuid := gen_random_uuid();
  v_building uuid := gen_random_uuid();
  v_alley uuid := gen_random_uuid();
  v_row record;
  v_definition text;
  v_revision uuid;
BEGIN
  SELECT cert.run_id, cert.world_id, cert.shard_id,
         cert.status, cert.expires_at,
         world.status AS world_status, world.metadata,
         shard.status AS shard_status
  INTO v_run
  FROM game.certification_runs cert
  JOIN game.worlds world ON world.world_id = cert.world_id
  JOIN game.world_shards shard
    ON shard.world_id = cert.world_id AND shard.shard_id = cert.shard_id
  WHERE cert.run_id = p_run_id
  FOR UPDATE OF cert;

  IF NOT FOUND
    OR v_run.status <> 'active'
    OR v_run.expires_at <= now()
    OR v_run.world_status <> 'active'
    OR v_run.shard_status <> 'active'
    OR v_run.world_id = '00000000-0000-4000-8000-000000000001'::uuid
    OR v_run.metadata->>'isolatedCertification' IS DISTINCT FROM 'true'
  THEN
    RAISE EXCEPTION 'Active, isolated certification run required'
      USING ERRCODE = '42501';
  END IF;

  v_ids := v_run.metadata->'certificationDistrict';
  IF v_ids IS NOT NULL THEN
    IF v_ids->>'runId' IS DISTINCT FROM p_run_id::text
      OR v_ids->>'worldId' IS DISTINCT FROM v_run.world_id::text
      OR v_ids->>'shardId' IS DISTINCT FROM v_run.shard_id::text
      OR (
        SELECT count(*)
        FROM game.entity_instances instance
        WHERE instance.world_id = v_run.world_id
          AND instance.shard_id = v_run.shard_id
          AND instance.instance_id IN (
            (v_ids->>'cityId')::uuid, (v_ids->>'districtId')::uuid,
            (v_ids->>'neighborhoodId')::uuid, (v_ids->>'buildingId')::uuid,
            (v_ids->>'alleyId')::uuid
          )
      ) <> 5
    THEN
      RAISE EXCEPTION 'Incomplete or cross-world certification district'
        USING ERRCODE = '23514';
    END IF;
    RETURN v_ids;
  END IF;

  FOR v_row IN
    SELECT role, name, description, instance_id, parent_id
    FROM (VALUES
      ('city', 'Calder City',
       'A coastal city with an observable economy and complicated local history.',
       v_city, NULL::uuid),
      ('district', 'Foundry Ward',
       'An industrial district of workshops, apartment buildings and warehouses.',
       v_district, v_city),
      ('neighborhood', 'Hester Street',
       'A compact block of storefronts, tenants and imperfect witnesses.',
       v_neighborhood, v_district),
      ('building', 'Ashdown Annex',
       'A worn brick apartment building with an accessible rear service exit.',
       v_building, v_neighborhood),
      ('alley', 'Rear Service Alley',
       'A service alley behind Ashdown Annex, with bins, deliveries and fire escapes.',
       v_alley, v_neighborhood)
    ) AS fixture(role, name, description, instance_id, parent_id)
  LOOP
    v_definition := 'CERT-LOCATION-' || gen_random_uuid()::text;
    v_revision := gen_random_uuid();
    INSERT INTO game.entity_definitions (
      definition_id, definition_type, name, concept_summary,
      origin_source, lifecycle_status, world_id
    ) VALUES (
      v_definition, 'location', v_row.name, v_row.description,
      'isolated_certification', 'approved', v_run.world_id
    );
    INSERT INTO game.definition_revisions (
      revision_id, definition_id, payload, change_summary, world_id
    ) VALUES (
      v_revision, v_definition,
      jsonb_build_object(
        'definitionType', 'location',
        'name', v_row.name,
        'conceptSummary', v_row.description
      ),
      'Provision isolated certification geography', v_run.world_id
    );
    UPDATE game.entity_definitions SET current_revision_id = v_revision
    WHERE definition_id = v_definition AND world_id = v_run.world_id;
    INSERT INTO game.entity_instances (
      instance_id, definition_id, location_id, condition, state,
      world_id, shard_id
    ) VALUES (
      v_row.instance_id, v_definition, v_row.parent_id, 100,
      jsonb_build_object('certificationRole', v_row.role, 'runId', p_run_id),
      v_run.world_id, v_run.shard_id
    );
    IF v_row.parent_id IS NOT NULL THEN
      INSERT INTO game.entity_relations (
        source_instance_id, target_instance_id, relation_type,
        parameters, world_id
      ) VALUES (
        v_row.instance_id, v_row.parent_id,
        'located_within', '{}'::jsonb, v_run.world_id
      );
    END IF;
  END LOOP;

  INSERT INTO game.entity_relations (
    source_instance_id, target_instance_id, relation_type,
    parameters, world_id
  ) VALUES (
    v_building, v_alley, 'adjacent_to',
    jsonb_build_object(
      'connectionType', 'rear_service_exit',
      'travel_time_seconds', 45,
      'bidirectional', true,
      'visibility', 'player_known'
    ),
    v_run.world_id
  );

  v_ids := jsonb_build_object(
    'runId', p_run_id, 'worldId', v_run.world_id,
    'shardId', v_run.shard_id,
    'cityId', v_city, 'districtId', v_district,
    'neighborhoodId', v_neighborhood,
    'buildingId', v_building, 'alleyId', v_alley
  );
  UPDATE game.worlds
  SET metadata = metadata || jsonb_build_object('certificationDistrict', v_ids),
      updated_at = now()
  WHERE world_id = v_run.world_id;
  RETURN v_ids;
END;
$$;

CREATE OR REPLACE FUNCTION game.provision_certification_player(
  p_run_id uuid, p_user_id text, p_name text
)
RETURNS TABLE (
  actor_id uuid,
  residence_id uuid,
  already_provisioned boolean
)
LANGUAGE plpgsql
AS $$
DECLARE
  v_run record;
  v_district jsonb;
  v_building uuid;
  v_existing_actor uuid;
  v_existing_residence uuid;
  v_actor uuid := gen_random_uuid();
  v_residence uuid := gen_random_uuid();
  v_actor_definition text := 'CERT-CHAR-' || gen_random_uuid()::text;
  v_unit_definition text := 'CERT-RESIDENCE-' || gen_random_uuid()::text;
  v_actor_revision uuid := gen_random_uuid();
  v_unit_revision uuid := gen_random_uuid();
  v_actor_event uuid := gen_random_uuid();
  v_unit_event uuid := gen_random_uuid();
  v_unit_number integer;
  v_unit_label text;
  v_unit_name text;
  v_capacities jsonb := jsonb_build_object(
    'space', 1, 'power', 1, 'concealment', 0, 'security', 0,
    'access', 1, 'comfort', 1
  );
BEGIN
  IF btrim(COALESCE(p_user_id, '')) = ''
    OR length(btrim(COALESCE(p_name, ''))) NOT BETWEEN 2 AND 80
  THEN
    RAISE EXCEPTION 'Certification player identity/name missing'
      USING ERRCODE = '42501';
  END IF;
  -- The district helper holds its own run lock and commits at the enclosing
  -- transaction boundary. This function takes the same lock for unique units.
  v_district := game.provision_certification_district(p_run_id);

  SELECT cert.run_id, cert.world_id, cert.shard_id, cert.status,
         cert.expires_at, world.status AS world_status,
         world.metadata, shard.status AS shard_status
  INTO v_run
  FROM game.certification_runs cert
  JOIN game.worlds world ON world.world_id = cert.world_id
  JOIN game.world_shards shard
    ON shard.world_id = cert.world_id AND shard.shard_id = cert.shard_id
  WHERE cert.run_id = p_run_id
  FOR UPDATE OF cert;

  IF NOT FOUND
    OR v_run.status <> 'active'
    OR v_run.expires_at <= now()
    OR v_run.world_status <> 'active'
    OR v_run.shard_status <> 'active'
    OR v_run.world_id = '00000000-0000-4000-8000-000000000001'::uuid
    OR v_run.metadata->>'isolatedCertification' IS DISTINCT FROM 'true'
    OR v_district->>'worldId' IS DISTINCT FROM v_run.world_id::text
    OR v_district->>'shardId' IS DISTINCT FROM v_run.shard_id::text
  THEN
    RAISE EXCEPTION 'Certification run not active or scoped correctly'
      USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM game.certification_players player
    JOIN game.world_memberships member
      ON member.world_id = player.world_id
     AND member.user_id = player.user_id
    WHERE player.run_id = p_run_id
      AND player.user_id = p_user_id
      AND player.world_id = v_run.world_id
      AND player.shard_id = v_run.shard_id
      AND member.role = 'player'
      AND member.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Account is not a player bound to this run'
      USING ERRCODE = '42501';
  END IF;

  SELECT pc.character_instance_id, occupancy.residence_instance_id
  INTO v_existing_actor, v_existing_residence
  FROM game.player_characters pc
  JOIN game.entity_instances actor
    ON actor.instance_id = pc.character_instance_id
   AND actor.world_id = pc.world_id
   AND actor.shard_id = v_run.shard_id
  LEFT JOIN game.residence_occupancies occupancy
    ON occupancy.character_instance_id = pc.character_instance_id
   AND occupancy.world_id = pc.world_id
   AND occupancy.status = 'active'
  WHERE pc.world_id = v_run.world_id AND pc.user_id = p_user_id
  LIMIT 1;

  IF v_existing_actor IS NOT NULL THEN
    IF v_existing_residence IS NULL THEN
      RAISE EXCEPTION 'Existing certification actor is missing housing'
        USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT v_existing_actor, v_existing_residence, true;
    RETURN;
  END IF;

  v_building := (v_district->>'buildingId')::uuid;
  SELECT count(*)::integer INTO v_unit_number
  FROM game.residence_occupancies occupancy
  WHERE occupancy.world_id = v_run.world_id
    AND occupancy.status = 'active';
  v_unit_label := (2 + v_unit_number / 8)::text ||
    chr(65 + (v_unit_number % 8));
  v_unit_name := 'Ashdown Annex, Unit ' || v_unit_label;

  INSERT INTO game.entity_definitions (
    definition_id, definition_type, name, concept_summary,
    origin_source, lifecycle_status, world_id
  ) VALUES (
    v_actor_definition, 'character', p_name,
    'A fictional player in an isolated urban crime-drama certification.',
    'isolated_certification', 'approved', v_run.world_id
  );
  INSERT INTO game.definition_revisions (
    revision_id, definition_id, payload, change_summary, world_id
  ) VALUES (
    v_actor_revision, v_actor_definition,
    jsonb_build_object(
      'definitionType', 'character',
      'name', p_name,
      'conceptSummary', 'An independently authenticated test player.'
    ),
    'Provision isolated player actor', v_run.world_id
  );
  UPDATE game.entity_definitions SET current_revision_id = v_actor_revision
  WHERE definition_id = v_actor_definition AND world_id = v_run.world_id;

  INSERT INTO game.entity_definitions (
    definition_id, definition_type, name, concept_summary,
    origin_source, lifecycle_status, world_id
  ) VALUES (
    v_unit_definition, 'residence', v_unit_name,
    'A bare-bones low-rent apartment, with ordinary utilities and weak locks.',
    'isolated_certification', 'approved', v_run.world_id
  );
  INSERT INTO game.definition_revisions (
    revision_id, definition_id, payload, change_summary, world_id
  ) VALUES (
    v_unit_revision, v_unit_definition,
    jsonb_build_object(
      'definitionType', 'residence',
      'name', v_unit_name,
      'conceptSummary', 'A bare-bones apartment with weak locks.',
      'extensionPayload', jsonb_build_object(
        'housing', jsonb_build_object(
          'tier', 'bare_bones',
          'buildingId', v_building,
          'unitLabel', v_unit_label
        ),
        'capacities', v_capacities
      )
    ),
    'Provision isolated starter apartment', v_run.world_id
  );
  UPDATE game.entity_definitions SET current_revision_id = v_unit_revision
  WHERE definition_id = v_unit_definition AND world_id = v_run.world_id;

  INSERT INTO game.entity_instances (
    instance_id, definition_id, location_id, condition, state,
    world_id, shard_id
  ) VALUES (
    v_actor, v_actor_definition, NULL, 100,
    jsonb_build_object(
      'active', true, 'skills', '{}'::jsonb,
      'cashOnPerson', 50000, 'heat', 0, 'warrant', false,
      'factionStanding', '{}'::jsonb
    ),
    v_run.world_id, v_run.shard_id
  );
  INSERT INTO game.entity_instances (
    instance_id, definition_id, location_id, condition, state,
    world_id, shard_id
  ) VALUES (
    v_residence, v_unit_definition, v_building, 72,
    jsonb_build_object(
      'housingType', 'starter_apartment',
      'housingTier', 'bare_bones',
      'buildingId', v_building,
      'unitLabel', v_unit_label,
      'privateInterior', true,
      'rentCents', 0,
      'capacities', v_capacities
    ),
    v_run.world_id, v_run.shard_id
  );

  INSERT INTO game.player_characters (
    user_id, character_instance_id, selected, world_id
  ) VALUES (p_user_id, v_actor, true, v_run.world_id);
  INSERT INTO game.residence_occupancies (
    residence_instance_id, character_instance_id,
    user_id, status, world_id
  ) VALUES (v_residence, v_actor, p_user_id, 'active', v_run.world_id);
  INSERT INTO game.entity_relations (
    source_instance_id, target_instance_id, relation_type,
    parameters, world_id
  ) VALUES
    (v_residence, v_building, 'located_within',
     jsonb_build_object('unitLabel', v_unit_label), v_run.world_id),
    (v_actor, v_residence, 'occupies',
     '{"role":"tenant","starter":true}'::jsonb, v_run.world_id);
  UPDATE game.entity_instances
  SET location_id = v_residence, updated_at = now()
  WHERE instance_id = v_actor AND world_id = v_run.world_id;

  INSERT INTO game.event_ledger (
    event_id, idempotency_key, world_time, event_type,
    involved_entity_ids, payload, world_id, shard_id
  ) VALUES (
    v_actor_event,
    'certification:' || p_run_id::text || ':' || p_user_id || ':character',
    now(), 'character_created', jsonb_build_array(v_actor),
    jsonb_build_object(
      'characterId', v_actor, 'definitionId', v_actor_definition,
      'userId', p_user_id
    ),
    v_run.world_id, v_run.shard_id
  ), (
    v_unit_event,
    'certification:' || p_run_id::text || ':' || p_user_id || ':residence',
    now(), 'starter_residence_provisioned',
    jsonb_build_array(v_actor, v_residence, v_building),
    jsonb_build_object(
      'characterId', v_actor, 'residenceId', v_residence,
      'buildingId', v_building, 'unitLabel', v_unit_label,
      'housingTier', 'bare_bones', 'userId', p_user_id
    ),
    v_run.world_id, v_run.shard_id
  );
  UPDATE game.entity_instances SET created_event_id = v_actor_event
  WHERE instance_id = v_actor AND world_id = v_run.world_id;
  UPDATE game.entity_instances SET created_event_id = v_unit_event
  WHERE instance_id = v_residence AND world_id = v_run.world_id;
  UPDATE game.world_memberships
  SET selected_character_id = v_actor, updated_at = now()
  WHERE world_id = v_run.world_id AND user_id = p_user_id;

  RETURN QUERY SELECT v_actor, v_residence, false;
END;
$$;
