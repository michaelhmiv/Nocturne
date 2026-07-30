-- Phase 2: Calder City world seed
-- 11 districts, 55 locations, travel graph, 10 NPCs

DO $$
DECLARE
  -- District UUIDs (deterministic)
  downtown       uuid := 'd1000000-1000-4000-8000-000000000001';
  harbor         uuid := 'd1000000-1000-4000-8000-000000000002';
  industrial     uuid := 'd1000000-1000-4000-8000-000000000003';
  midtown        uuid := 'd1000000-1000-4000-8000-000000000004';
  uptown         uuid := 'd1000000-1000-4000-8000-000000000005';
  heights        uuid := 'd1000000-1000-4000-8000-000000000006';
  eastside       uuid := 'd1000000-1000-4000-8000-000000000007';
  westside       uuid := 'd1000000-1000-4000-8000-000000000008';
  oldtown        uuid := 'd1000000-1000-4000-8000-000000000009';
  southgate      uuid := 'd1000000-1000-4000-8000-00000000000a';
  underground    uuid := 'd1000000-1000-4000-8000-00000000000b';
  calder_city    uuid := 'd1000000-1000-4000-8000-0000000000ff';
  rev_id uuid;
  loc_id uuid;
BEGIN
  --------------------------------------------------------------------
  -- Helper: idempotent entity definition + revision
  --------------------------------------------------------------------
  CREATE OR REPLACE FUNCTION seed_definition(def_id uuid, def_name text, def_type text)
  RETURNS void AS $fn$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM game.entity_definitions WHERE definition_id = def_id::text) THEN
      INSERT INTO game.entity_definitions (definition_id, name, definition_type, lifecycle_status, concept_summary)
      VALUES (def_id::text, def_name, def_type, 'approved', '');
      INSERT INTO game.definition_revisions (revision_id, definition_id, schema_version, payload, change_summary)
      VALUES (gen_random_uuid(), def_id::text, 1, '{}', 'World seed migration');
      UPDATE game.entity_definitions SET current_revision_id = (
        SELECT revision_id FROM game.definition_revisions WHERE definition_id = def_id::text ORDER BY created_at DESC LIMIT 1
      ) WHERE definition_id = def_id::text;
    END IF;
  END;
  $fn$ LANGUAGE plpgsql;

  --------------------------------------------------------------------
  -- Helper: idempotent entity instance
  --------------------------------------------------------------------
  CREATE OR REPLACE FUNCTION seed_instance(inst_id uuid, def_id uuid, st jsonb)
  RETURNS void AS $fn$
  BEGIN
    INSERT INTO game.entity_instances (instance_id, definition_id, state)
    VALUES (inst_id, def_id::text, st)
    ON CONFLICT (instance_id) DO NOTHING;
  END;
  $fn$ LANGUAGE plpgsql;

  --------------------------------------------------------------------
  -- Helper: idempotent relation
  --------------------------------------------------------------------
  CREATE OR REPLACE FUNCTION seed_relation(src uuid, tgt uuid, rel text, params jsonb)
  RETURNS void AS $fn$
  BEGIN
    INSERT INTO game.entity_relations (source_instance_id, target_instance_id, relation_type, parameters)
    VALUES (src, tgt, rel, params)
    ON CONFLICT DO NOTHING;
  END;
  $fn$ LANGUAGE plpgsql;

  --------------------------------------------------------------------
  -- 1. DISTRICT DEFINITIONS + INSTANCES
  --------------------------------------------------------------------
  FOR loc_id IN SELECT id FROM (VALUES
    (downtown),(harbor),(industrial),(midtown),(uptown),
    (heights),(eastside),(westside),(oldtown),(southgate),(underground)
  ) AS t(id)
  LOOP
    PERFORM seed_definition(loc_id, 
      CASE loc_id
        WHEN downtown    THEN 'The Grid (Downtown)'
        WHEN harbor      THEN 'Calder Harbor'
        WHEN industrial  THEN 'Rustbelt Industrial'
        WHEN midtown     THEN 'Midtown Calder'
        WHEN uptown      THEN 'Uptown / Diamond Row'
        WHEN heights     THEN 'The Heights'
        WHEN eastside    THEN 'Eastside Docks'
        WHEN westside    THEN 'Westside Commons'
        WHEN oldtown     THEN 'Oldtown Calder'
        WHEN southgate   THEN 'Southgate Terminal'
        WHEN underground THEN 'The Underground'
      END, 'location');
    PERFORM seed_instance(loc_id, loc_id, '{}');
  END LOOP;

  PERFORM seed_definition(calder_city, 'Calder City', 'location');
  PERFORM seed_instance(calder_city, calder_city, '{}');

  -- District containment
  FOR loc_id IN SELECT id FROM (VALUES
    (downtown),(harbor),(industrial),(midtown),(uptown),
    (heights),(eastside),(westside),(oldtown),(southgate),(underground)
  ) AS t(id)
  LOOP
    PERFORM seed_relation(loc_id, calder_city, 'located_within', '{}');
  END LOOP;

  --------------------------------------------------------------------
  -- 2. 55 LOCATIONS (~5 per district)
  --------------------------------------------------------------------
  -- Downtown
  PERFORM seed_definition('e0101000-0000-4000-8000-000000000001', 'Grid PD Headquarters', 'location');
  PERFORM seed_instance('e0101000-0000-4000-8000-000000000001', 'e0101000-0000-4000-8000-000000000001', '{}');
  PERFORM seed_relation('e0101000-0000-4000-8000-000000000001', downtown, 'located_within', '{}');

  PERFORM seed_definition('e0101000-0000-4000-8000-000000000002', 'The Neon Cat (Nightclub)', 'location');
  PERFORM seed_instance('e0101000-0000-4000-8000-000000000002', 'e0101000-0000-4000-8000-000000000002', '{}');
  PERFORM seed_relation('e0101000-0000-4000-8000-000000000002', downtown, 'located_within', '{}');

  PERFORM seed_definition('e0101000-0000-4000-8000-000000000003', 'OmniCorp Tower (Lobby)', 'location');
  PERFORM seed_instance('e0101000-0000-4000-8000-000000000003', 'e0101000-0000-4000-8000-000000000003', '{}');
  PERFORM seed_relation('e0101000-0000-4000-8000-000000000003', downtown, 'located_within', '{}');

  PERFORM seed_definition('e0101000-0000-4000-8000-000000000004', 'Grid Pawn & Loan', 'location');
  PERFORM seed_instance('e0101000-0000-4000-8000-000000000004', 'e0101000-0000-4000-8000-000000000004', '{}');
  PERFORM seed_relation('e0101000-0000-4000-8000-000000000004', downtown, 'located_within', '{}');

  PERFORM seed_definition('e0101000-0000-4000-8000-000000000005', 'Noodle Bar 88', 'location');
  PERFORM seed_instance('e0101000-0000-4000-8000-000000000005', 'e0101000-0000-4000-8000-000000000005', '{}');
  PERFORM seed_relation('e0101000-0000-4000-8000-000000000005', downtown, 'located_within', '{}');

  -- Harbor
  PERFORM seed_definition('e0102000-0000-4000-8000-000000000001', 'Pier 7 Warehouse', 'location');
  PERFORM seed_instance('e0102000-0000-4000-8000-000000000001', 'e0102000-0000-4000-8000-000000000001', '{}');
  PERFORM seed_relation('e0102000-0000-4000-8000-000000000001', harbor, 'located_within', '{}');

  PERFORM seed_definition('e0102000-0000-4000-8000-000000000002', 'Harbor Customs Office', 'location');
  PERFORM seed_instance('e0102000-0000-4000-8000-000000000002', 'e0102000-0000-4000-8000-000000000002', '{}');
  PERFORM seed_relation('e0102000-0000-4000-8000-000000000002', harbor, 'located_within', '{}');

  PERFORM seed_definition('e0102000-0000-4000-8000-000000000003', 'The Salt Dog (Bar)', 'location');
  PERFORM seed_instance('e0102000-0000-4000-8000-000000000003', 'e0102000-0000-4000-8000-000000000003', '{}');
  PERFORM seed_relation('e0102000-0000-4000-8000-000000000003', harbor, 'located_within', '{}');

  PERFORM seed_definition('e0102000-0000-4000-8000-000000000004', 'Smugglers Cove', 'location');
  PERFORM seed_instance('e0102000-0000-4000-8000-000000000004', 'e0102000-0000-4000-8000-000000000004', '{}');
  PERFORM seed_relation('e0102000-0000-4000-8000-000000000004', harbor, 'located_within', '{}');

  PERFORM seed_definition('e0102000-0000-4000-8000-000000000005', 'Fish Market', 'location');
  PERFORM seed_instance('e0102000-0000-4000-8000-000000000005', 'e0102000-0000-4000-8000-000000000005', '{}');
  PERFORM seed_relation('e0102000-0000-4000-8000-000000000005', harbor, 'located_within', '{}');

  -- Industrial
  PERFORM seed_definition('e0103000-0000-4000-8000-000000000001', 'Ironworks Foundry', 'location');
  PERFORM seed_instance('e0103000-0000-4000-8000-000000000001', 'e0103000-0000-4000-8000-000000000001', '{}');
  PERFORM seed_relation('e0103000-0000-4000-8000-000000000001', industrial, 'located_within', '{}');

  PERFORM seed_definition('e0103000-0000-4000-8000-000000000002', 'Rustbelt Auto Shop', 'location');
  PERFORM seed_instance('e0103000-0000-4000-8000-000000000002', 'e0103000-0000-4000-8000-000000000002', '{}');
  PERFORM seed_relation('e0103000-0000-4000-8000-000000000002', industrial, 'located_within', '{}');

  PERFORM seed_definition('e0103000-0000-4000-8000-000000000003', 'Junkyard', 'location');
  PERFORM seed_instance('e0103000-0000-4000-8000-000000000003', 'e0103000-0000-4000-8000-000000000003', '{}');
  PERFORM seed_relation('e0103000-0000-4000-8000-000000000003', industrial, 'located_within', '{}');

  PERFORM seed_definition('e0103000-0000-4000-8000-000000000004', 'Power Plant Substation', 'location');
  PERFORM seed_instance('e0103000-0000-4000-8000-000000000004', 'e0103000-0000-4000-8000-000000000004', '{}');
  PERFORM seed_relation('e0103000-0000-4000-8000-000000000004', industrial, 'located_within', '{}');

  PERFORM seed_definition('e0103000-0000-4000-8000-000000000005', 'Scrap King Recycling', 'location');
  PERFORM seed_instance('e0103000-0000-4000-8000-000000000005', 'e0103000-0000-4000-8000-000000000005', '{}');
  PERFORM seed_relation('e0103000-0000-4000-8000-000000000005', industrial, 'located_within', '{}');

  -- Midtown
  PERFORM seed_definition('e0104000-0000-4000-8000-000000000001', 'Midtown Hospital', 'location');
  PERFORM seed_instance('e0104000-0000-4000-8000-000000000001', 'e0104000-0000-4000-8000-000000000001', '{}');
  PERFORM seed_relation('e0104000-0000-4000-8000-000000000001', midtown, 'located_within', '{}');

  PERFORM seed_definition('e0104000-0000-4000-8000-000000000002', 'Calder University', 'location');
  PERFORM seed_instance('e0104000-0000-4000-8000-000000000002', 'e0104000-0000-4000-8000-000000000002', '{}');
  PERFORM seed_relation('e0104000-0000-4000-8000-000000000002', midtown, 'located_within', '{}');

  PERFORM seed_definition('e0104000-0000-4000-8000-000000000003', 'Midtown Mall', 'location');
  PERFORM seed_instance('e0104000-0000-4000-8000-000000000003', 'e0104000-0000-4000-8000-000000000003', '{}');
  PERFORM seed_relation('e0104000-0000-4000-8000-000000000003', midtown, 'located_within', '{}');

  PERFORM seed_definition('e0104000-0000-4000-8000-000000000004', 'The Daily Beat (News Office)', 'location');
  PERFORM seed_instance('e0104000-0000-4000-8000-000000000004', 'e0104000-0000-4000-8000-000000000004', '{}');
  PERFORM seed_relation('e0104000-0000-4000-8000-000000000004', midtown, 'located_within', '{}');

  PERFORM seed_definition('e0104000-0000-4000-8000-000000000005', 'Arcade Galaxy', 'location');
  PERFORM seed_instance('e0104000-0000-4000-8000-000000000005', 'e0104000-0000-4000-8000-000000000005', '{}');
  PERFORM seed_relation('e0104000-0000-4000-8000-000000000005', midtown, 'located_within', '{}');

  -- Uptown
  PERFORM seed_definition('e0105000-0000-4000-8000-000000000001', 'Diamond Row Bank & Trust', 'location');
  PERFORM seed_instance('e0105000-0000-4000-8000-000000000001', 'e0105000-0000-4000-8000-000000000001', '{}');
  PERFORM seed_relation('e0105000-0000-4000-8000-000000000001', uptown, 'located_within', '{}');

  PERFORM seed_definition('e0105000-0000-4000-8000-000000000002', 'Vanguard Tower (Penthouse)', 'location');
  PERFORM seed_instance('e0105000-0000-4000-8000-000000000002', 'e0105000-0000-4000-8000-000000000002', '{}');
  PERFORM seed_relation('e0105000-0000-4000-8000-000000000002', uptown, 'located_within', '{}');

  PERFORM seed_definition('e0105000-0000-4000-8000-000000000003', 'Calder Art Museum', 'location');
  PERFORM seed_instance('e0105000-0000-4000-8000-000000000003', 'e0105000-0000-4000-8000-000000000003', '{}');
  PERFORM seed_relation('e0105000-0000-4000-8000-000000000003', uptown, 'located_within', '{}');

  PERFORM seed_definition('e0105000-0000-4000-8000-000000000004', 'Ritz-Calder Hotel', 'location');
  PERFORM seed_instance('e0105000-0000-4000-8000-000000000004', 'e0105000-0000-4000-8000-000000000004', '{}');
  PERFORM seed_relation('e0105000-0000-4000-8000-000000000004', uptown, 'located_within', '{}');

  PERFORM seed_definition('e0105000-0000-4000-8000-000000000005', 'Embassy Row (Consulate)', 'location');
  PERFORM seed_instance('e0105000-0000-4000-8000-000000000005', 'e0105000-0000-4000-8000-000000000005', '{}');
  PERFORM seed_relation('e0105000-0000-4000-8000-000000000005', uptown, 'located_within', '{}');

  -- Heights
  PERFORM seed_definition('e0106000-0000-4000-8000-000000000001', 'Heights Apartments A', 'location');
  PERFORM seed_instance('e0106000-0000-4000-8000-000000000001', 'e0106000-0000-4000-8000-000000000001', '{}');
  PERFORM seed_relation('e0106000-0000-4000-8000-000000000001', heights, 'located_within', '{}');

  PERFORM seed_definition('e0106000-0000-4000-8000-000000000002', 'Heights Lofts B', 'location');
  PERFORM seed_instance('e0106000-0000-4000-8000-000000000002', 'e0106000-0000-4000-8000-000000000002', '{}');
  PERFORM seed_relation('e0106000-0000-4000-8000-000000000002', heights, 'located_within', '{}');

  PERFORM seed_definition('e0106000-0000-4000-8000-000000000003', 'Skyline Gym', 'location');
  PERFORM seed_instance('e0106000-0000-4000-8000-000000000003', 'e0106000-0000-4000-8000-000000000003', '{}');
  PERFORM seed_relation('e0106000-0000-4000-8000-000000000003', heights, 'located_within', '{}');

  PERFORM seed_definition('e0106000-0000-4000-8000-000000000004', 'Overlook Park', 'location');
  PERFORM seed_instance('e0106000-0000-4000-8000-000000000004', 'e0106000-0000-4000-8000-000000000004', '{}');
  PERFORM seed_relation('e0106000-0000-4000-8000-000000000004', heights, 'located_within', '{}');

  PERFORM seed_definition('e0106000-0000-4000-8000-000000000005', 'Calder Observatory', 'location');
  PERFORM seed_instance('e0106000-0000-4000-8000-000000000005', 'e0106000-0000-4000-8000-000000000005', '{}');
  PERFORM seed_relation('e0106000-0000-4000-8000-000000000005', heights, 'located_within', '{}');

  -- Eastside
  PERFORM seed_definition('e0107000-0000-4000-8000-000000000001', 'Eastside Boxing Gym', 'location');
  PERFORM seed_instance('e0107000-0000-4000-8000-000000000001', 'e0107000-0000-4000-8000-000000000001', '{}');
  PERFORM seed_relation('e0107000-0000-4000-8000-000000000001', eastside, 'located_within', '{}');

  PERFORM seed_definition('e0107000-0000-4000-8000-000000000002', 'Pan-Asian Market', 'location');
  PERFORM seed_instance('e0107000-0000-4000-8000-000000000002', 'e0107000-0000-4000-8000-000000000002', '{}');
  PERFORM seed_relation('e0107000-0000-4000-8000-000000000002', eastside, 'located_within', '{}');

  PERFORM seed_definition('e0107000-0000-4000-8000-000000000003', 'The Lantern (Tea House)', 'location');
  PERFORM seed_instance('e0107000-0000-4000-8000-000000000003', 'e0107000-0000-4000-8000-000000000003', '{}');
  PERFORM seed_relation('e0107000-0000-4000-8000-000000000003', eastside, 'located_within', '{}');

  PERFORM seed_definition('e0107000-0000-4000-8000-000000000004', 'Eastside Clinic', 'location');
  PERFORM seed_instance('e0107000-0000-4000-8000-000000000004', 'e0107000-0000-4000-8000-000000000004', '{}');
  PERFORM seed_relation('e0107000-0000-4000-8000-000000000004', eastside, 'located_within', '{}');

  PERFORM seed_definition('e0107000-0000-4000-8000-000000000005', 'Dojo of the Iron Fist', 'location');
  PERFORM seed_instance('e0107000-0000-4000-8000-000000000005', 'e0107000-0000-4000-8000-000000000005', '{}');
  PERFORM seed_relation('e0107000-0000-4000-8000-000000000005', eastside, 'located_within', '{}');

  -- Westside
  PERFORM seed_definition('e0108000-0000-4000-8000-000000000001', 'Westside Garage', 'location');
  PERFORM seed_instance('e0108000-0000-4000-8000-000000000001', 'e0108000-0000-4000-8000-000000000001', '{}');
  PERFORM seed_relation('e0108000-0000-4000-8000-000000000001', westside, 'located_within', '{}');

  PERFORM seed_definition('e0108000-0000-4000-8000-000000000002', 'Commons Library', 'location');
  PERFORM seed_instance('e0108000-0000-4000-8000-000000000002', 'e0108000-0000-4000-8000-000000000002', '{}');
  PERFORM seed_relation('e0108000-0000-4000-8000-000000000002', westside, 'located_within', '{}');

  PERFORM seed_definition('e0108000-0000-4000-8000-000000000003', 'Westside Diner', 'location');
  PERFORM seed_instance('e0108000-0000-4000-8000-000000000003', 'e0108000-0000-4000-8000-000000000003', '{}');
  PERFORM seed_relation('e0108000-0000-4000-8000-000000000003', westside, 'located_within', '{}');

  PERFORM seed_definition('e0108000-0000-4000-8000-000000000004', 'Mechanic Row', 'location');
  PERFORM seed_instance('e0108000-0000-4000-8000-000000000004', 'e0108000-0000-4000-8000-000000000004', '{}');
  PERFORM seed_relation('e0108000-0000-4000-8000-000000000004', westside, 'located_within', '{}');

  PERFORM seed_definition('e0108000-0000-4000-8000-000000000005', 'The Sleeping Giant (Motel)', 'location');
  PERFORM seed_instance('e0108000-0000-4000-8000-000000000005', 'e0108000-0000-4000-8000-000000000005', '{}');
  PERFORM seed_relation('e0108000-0000-4000-8000-000000000005', westside, 'located_within', '{}');

  -- Oldtown
  PERFORM seed_definition('e0109000-0000-4000-8000-000000000001', 'Oldtown Records Hall', 'location');
  PERFORM seed_instance('e0109000-0000-4000-8000-000000000001', 'e0109000-0000-4000-8000-000000000001', '{}');
  PERFORM seed_relation('e0109000-0000-4000-8000-000000000001', oldtown, 'located_within', '{}');

  PERFORM seed_definition('e0109000-0000-4000-8000-000000000002', 'St. Jude Cathedral', 'location');
  PERFORM seed_instance('e0109000-0000-4000-8000-000000000002', 'e0109000-0000-4000-8000-000000000002', '{}');
  PERFORM seed_relation('e0109000-0000-4000-8000-000000000002', oldtown, 'located_within', '{}');

  PERFORM seed_definition('e0109000-0000-4000-8000-000000000003', 'Black Cat Antiques', 'location');
  PERFORM seed_instance('e0109000-0000-4000-8000-000000000003', 'e0109000-0000-4000-8000-000000000003', '{}');
  PERFORM seed_relation('e0109000-0000-4000-8000-000000000003', oldtown, 'located_within', '{}');

  PERFORM seed_definition('e0109000-0000-4000-8000-000000000004', 'The Witching Hour (Occult Shop)', 'location');
  PERFORM seed_instance('e0109000-0000-4000-8000-000000000004', 'e0109000-0000-4000-8000-000000000004', '{}');
  PERFORM seed_relation('e0109000-0000-4000-8000-000000000004', oldtown, 'located_within', '{}');

  PERFORM seed_definition('e0109000-0000-4000-8000-000000000005', 'Oldtown Cemetery', 'location');
  PERFORM seed_instance('e0109000-0000-4000-8000-000000000005', 'e0109000-0000-4000-8000-000000000005', '{}');
  PERFORM seed_relation('e0109000-0000-4000-8000-000000000005', oldtown, 'located_within', '{}');

  -- Southgate
  PERFORM seed_definition('e010a000-0000-4000-8000-000000000001', 'Southgate Bus Terminal', 'location');
  PERFORM seed_instance('e010a000-0000-4000-8000-000000000001', 'e010a000-0000-4000-8000-000000000001', '{}');
  PERFORM seed_relation('e010a000-0000-4000-8000-000000000001', southgate, 'located_within', '{}');

  PERFORM seed_definition('e010a000-0000-4000-8000-000000000002', 'Calder City Jail', 'location');
  PERFORM seed_instance('e010a000-0000-4000-8000-000000000002', 'e010a000-0000-4000-8000-000000000002', '{}');
  PERFORM seed_relation('e010a000-0000-4000-8000-000000000002', southgate, 'located_within', '{}');

  PERFORM seed_definition('e010a000-0000-4000-8000-000000000003', 'Courthouse', 'location');
  PERFORM seed_instance('e010a000-0000-4000-8000-000000000003', 'e010a000-0000-4000-8000-000000000003', '{}');
  PERFORM seed_relation('e010a000-0000-4000-8000-000000000003', southgate, 'located_within', '{}');

  PERFORM seed_definition('e010a000-0000-4000-8000-000000000004', 'Southgate Gun Range', 'location');
  PERFORM seed_instance('e010a000-0000-4000-8000-000000000004', 'e010a000-0000-4000-8000-000000000004', '{}');
  PERFORM seed_relation('e010a000-0000-4000-8000-000000000004', southgate, 'located_within', '{}');

  PERFORM seed_definition('e010a000-0000-4000-8000-000000000005', 'The Turnpike Diner', 'location');
  PERFORM seed_instance('e010a000-0000-4000-8000-000000000005', 'e010a000-0000-4000-8000-000000000005', '{}');
  PERFORM seed_relation('e010a000-0000-4000-8000-000000000005', southgate, 'located_within', '{}');

  -- Underground
  PERFORM seed_definition('e010b000-0000-4000-8000-000000000001', 'Subway Tunnel (Abandoned)', 'location');
  PERFORM seed_instance('e010b000-0000-4000-8000-000000000001', 'e010b000-0000-4000-8000-000000000001', '{}');
  PERFORM seed_relation('e010b000-0000-4000-8000-000000000001', underground, 'located_within', '{}');

  PERFORM seed_definition('e010b000-0000-4000-8000-000000000002', 'The Warrens (Black Market)', 'location');
  PERFORM seed_instance('e010b000-0000-4000-8000-000000000002', 'e010b000-0000-4000-8000-000000000002', '{}');
  PERFORM seed_relation('e010b000-0000-4000-8000-000000000002', underground, 'located_within', '{}');

  PERFORM seed_definition('e010b000-0000-4000-8000-000000000003', 'Sewer Junction', 'location');
  PERFORM seed_instance('e010b000-0000-4000-8000-000000000003', 'e010b000-0000-4000-8000-000000000003', '{}');
  PERFORM seed_relation('e010b000-0000-4000-8000-000000000003', underground, 'located_within', '{}');

  PERFORM seed_definition('e010b000-0000-4000-8000-000000000004', 'Old Utility Bunker', 'location');
  PERFORM seed_instance('e010b000-0000-4000-8000-000000000004', 'e010b000-0000-4000-8000-000000000004', '{}');
  PERFORM seed_relation('e010b000-0000-4000-8000-000000000004', underground, 'located_within', '{}');

  PERFORM seed_definition('e010b000-0000-4000-8000-000000000005', 'Hacker Den (Node 7)', 'location');
  PERFORM seed_instance('e010b000-0000-4000-8000-000000000005', 'e010b000-0000-4000-8000-000000000005', '{}');
  PERFORM seed_relation('e010b000-0000-4000-8000-000000000005', underground, 'located_within', '{}');

  --------------------------------------------------------------------
  -- 3. TRAVEL GRAPH (adjacent_to edges with travel_time_seconds)
  --------------------------------------------------------------------
  CREATE OR REPLACE FUNCTION seed_road(from_loc uuid, to_loc uuid, time_secs int)
  RETURNS void AS $fn$
  BEGIN
    PERFORM seed_relation(from_loc, to_loc, 'adjacent_to', jsonb_build_object('travel_time_seconds', time_secs));
    PERFORM seed_relation(to_loc, from_loc, 'adjacent_to', jsonb_build_object('travel_time_seconds', time_secs));
  END;
  $fn$ LANGUAGE plpgsql;

  -- District-level roads
  PERFORM seed_road(downtown, harbor, 180);
  PERFORM seed_road(downtown, midtown, 120);
  PERFORM seed_road(downtown, eastside, 150);
  PERFORM seed_road(downtown, underground, 60);

  PERFORM seed_road(harbor, industrial, 240);
  PERFORM seed_road(harbor, eastside, 90);

  PERFORM seed_road(industrial, westside, 180);
  PERFORM seed_road(industrial, southgate, 300);

  PERFORM seed_road(midtown, uptown, 90);
  PERFORM seed_road(midtown, heights, 120);
  PERFORM seed_road(midtown, eastside, 120);

  PERFORM seed_road(uptown, heights, 60);
  PERFORM seed_road(uptown, oldtown, 180);

  PERFORM seed_road(heights, westside, 150);

  PERFORM seed_road(eastside, southgate, 240);

  PERFORM seed_road(westside, southgate, 120);
  PERFORM seed_road(westside, oldtown, 90);

  PERFORM seed_road(oldtown, southgate, 60);
  PERFORM seed_road(oldtown, underground, 120);

  PERFORM seed_road(southgate, underground, 60);

  -- Within-district roads (30-60s)
  PERFORM seed_road('e0101000-0000-4000-8000-000000000001', 'e0101000-0000-4000-8000-000000000002', 30);
  PERFORM seed_road('e0102000-0000-4000-8000-000000000003', 'e0102000-0000-4000-8000-000000000004', 45);
  PERFORM seed_road('e0104000-0000-4000-8000-000000000001', 'e0104000-0000-4000-8000-000000000002', 30);
  PERFORM seed_road('e0105000-0000-4000-8000-000000000001', 'e0105000-0000-4000-8000-000000000004', 30);
  PERFORM seed_road('e0109000-0000-4000-8000-000000000003', 'e0109000-0000-4000-8000-000000000004', 30);

  --------------------------------------------------------------------
  -- 4. NPC DEFINITIONS + INSTANCES
  --------------------------------------------------------------------
  PERFORM seed_definition('aa000000-0000-4000-8000-000000000001', 'Detective Rosa Mendez', 'character');
  PERFORM seed_instance('aa000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000001', '{"schedule": {"default": "Grid PD Headquarters", "night": "The Neon Cat (Nightclub)"}}');

  PERFORM seed_definition('aa000000-0000-4000-8000-000000000002', 'Marcus Kane (Fixer)', 'character');
  PERFORM seed_instance('aa000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-000000000002', '{"schedule": {"default": "The Neon Cat (Nightclub)", "day": "Grid Pawn & Loan"}}');

  PERFORM seed_definition('aa000000-0000-4000-8000-000000000003', 'Doctor Lena Park', 'character');
  PERFORM seed_instance('aa000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-000000000003', '{"schedule": {"default": "Midtown Hospital"}}');

  PERFORM seed_definition('aa000000-0000-4000-8000-000000000004', 'Big Lou (Pawn Broker)', 'character');
  PERFORM seed_instance('aa000000-0000-4000-8000-000000000004', 'aa000000-0000-4000-8000-000000000004', '{"schedule": {"default": "Grid Pawn & Loan"}}');

  PERFORM seed_definition('aa000000-0000-4000-8000-000000000005', 'Shiro Tanaka (Yakuza)', 'character');
  PERFORM seed_instance('aa000000-0000-4000-8000-000000000005', 'aa000000-0000-4000-8000-000000000005', '{"schedule": {"default": "The Lantern (Tea House)", "night": "The Salt Dog (Bar)"}}');

  PERFORM seed_definition('aa000000-0000-4000-8000-000000000006', 'Catherine Voss (CEO)', 'character');
  PERFORM seed_instance('aa000000-0000-4000-8000-000000000006', 'aa000000-0000-4000-8000-000000000006', '{"schedule": {"default": "Vanguard Tower (Penthouse)", "day": "OmniCorp Tower (Lobby)"}}');

  PERFORM seed_definition('aa000000-0000-4000-8000-000000000007', 'Ricky Sparks (Mechanic)', 'character');
  PERFORM seed_instance('aa000000-0000-4000-8000-000000000007', 'aa000000-0000-4000-8000-000000000007', '{"schedule": {"default": "Rustbelt Auto Shop"}}');

  PERFORM seed_definition('aa000000-0000-4000-8000-000000000008', '"Spider" (Hacker)', 'character');
  PERFORM seed_instance('aa000000-0000-4000-8000-000000000008', 'aa000000-0000-4000-8000-000000000008', '{"schedule": {"default": "Hacker Den (Node 7)"}}');

  PERFORM seed_definition('aa000000-0000-4000-8000-000000000009', 'Sister Agnes', 'character');
  PERFORM seed_instance('aa000000-0000-4000-8000-000000000009', 'aa000000-0000-4000-8000-000000000009', '{"schedule": {"default": "St. Jude Cathedral", "night": "Oldtown Cemetery"}}');

  PERFORM seed_definition('aa000000-0000-4000-8000-00000000000a', 'Captain Elena Voss', 'character');
  PERFORM seed_instance('aa000000-0000-4000-8000-00000000000a', 'aa000000-0000-4000-8000-00000000000a', '{"schedule": {"default": "Harbor Customs Office"}}');

  -- NPC locations
  PERFORM seed_relation('aa000000-0000-4000-8000-000000000001', 'e0101000-0000-4000-8000-000000000001', 'located_at', '{}');
  PERFORM seed_relation('aa000000-0000-4000-8000-000000000002', 'e0101000-0000-4000-8000-000000000002', 'located_at', '{}');
  PERFORM seed_relation('aa000000-0000-4000-8000-000000000003', 'e0104000-0000-4000-8000-000000000001', 'located_at', '{}');
  PERFORM seed_relation('aa000000-0000-4000-8000-000000000004', 'e0101000-0000-4000-8000-000000000004', 'located_at', '{}');
  PERFORM seed_relation('aa000000-0000-4000-8000-000000000005', 'e0107000-0000-4000-8000-000000000003', 'located_at', '{}');
  PERFORM seed_relation('aa000000-0000-4000-8000-000000000006', 'e0105000-0000-4000-8000-000000000002', 'located_at', '{}');
  PERFORM seed_relation('aa000000-0000-4000-8000-000000000007', 'e0103000-0000-4000-8000-000000000002', 'located_at', '{}');
  PERFORM seed_relation('aa000000-0000-4000-8000-000000000008', 'e010b000-0000-4000-8000-000000000005', 'located_at', '{}');
  PERFORM seed_relation('aa000000-0000-4000-8000-000000000009', 'e0109000-0000-4000-8000-000000000002', 'located_at', '{}');
  PERFORM seed_relation('aa000000-0000-4000-8000-00000000000a', 'e0102000-0000-4000-8000-000000000002', 'located_at', '{}');

  -- Cleanup
  DROP FUNCTION IF EXISTS seed_definition;
  DROP FUNCTION IF EXISTS seed_instance;
  DROP FUNCTION IF EXISTS seed_relation;
  DROP FUNCTION IF EXISTS seed_road;
END $$;
