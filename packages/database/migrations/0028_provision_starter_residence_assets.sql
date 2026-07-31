-- The starter world is created lazily by the API after migrations finish. The
-- original ambient-provision migration therefore cannot assume Unit 3B exists.
-- Install an idempotent provisioning function and trigger so clean databases,
-- production upgrades, and repeated starter-world seeding converge on the same
-- broad semantic source without maintaining a fixed food catalogue.

CREATE OR REPLACE FUNCTION game.provision_starter_residence_assets()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM game.entity_instances
    WHERE instance_id = '10000000-0000-4000-8000-000000000005'
  ) THEN
    RETURN;
  END IF;

  INSERT INTO game.ambient_asset_pools (
    pool_id,
    container_instance_id,
    name,
    description,
    units_remaining,
    constraints,
    state,
    visibility
  ) VALUES (
    '70000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000005',
    'Ordinary Kitchen Provisions',
    'A broad household supply from which the semantic resolver may derive plausible ordinary, inexpensive food, nonalcoholic drink, basic medicine, and cooking ingredients. It does not authorize luxury, rare, specialty, hazardous, or implausibly abundant items.',
    100000,
    '[
      "ordinary household consumables only",
      "derive semantics from the player request and scene context",
      "no luxury rare specialty or hazardous substances without separate authority",
      "maximum five units per action",
      "this is an ambient possibility source, not a fixed item catalogue"
    ]'::jsonb,
    '{
      "sourcePolicy":"generic-household-provisions-v2",
      "renewableDuringPrototype":true,
      "semanticCatalog":false,
      "minimumOperationalUnits":100000
    }'::jsonb,
    'player_known'
  )
  ON CONFLICT (pool_id) DO UPDATE
  SET container_instance_id = EXCLUDED.container_instance_id,
      name = EXCLUDED.name,
      description = EXCLUDED.description,
      units_remaining = GREATEST(game.ambient_asset_pools.units_remaining, EXCLUDED.units_remaining),
      constraints = EXCLUDED.constraints,
      state = COALESCE(game.ambient_asset_pools.state, '{}'::jsonb) || EXCLUDED.state,
      visibility = EXCLUDED.visibility,
      updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION game.provision_starter_residence_assets_after_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.instance_id = '10000000-0000-4000-8000-000000000005' THEN
    PERFORM game.provision_starter_residence_assets();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS provision_starter_residence_assets_after_insert
  ON game.entity_instances;

CREATE TRIGGER provision_starter_residence_assets_after_insert
AFTER INSERT ON game.entity_instances
FOR EACH ROW
EXECUTE FUNCTION game.provision_starter_residence_assets_after_insert();

-- Upgrade databases where the residence already exists and keep retries safe.
SELECT game.provision_starter_residence_assets();
