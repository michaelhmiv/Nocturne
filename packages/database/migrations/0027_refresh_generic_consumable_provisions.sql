-- The prototype kitchen pool was intentionally sparse and permanently depleted.
-- Persistent-world consumption needs a broad mundane semantic source rather than a
-- fixed food catalogue or a one-time onboarding allowance.

UPDATE game.ambient_asset_pools
SET name = CASE
      WHEN name ILIKE '%kitchen%' OR name ILIKE '%provision%'
        THEN 'Ordinary Kitchen Provisions'
      ELSE name
    END,
    description = CASE
      WHEN name ILIKE '%kitchen%' OR name ILIKE '%provision%'
        THEN 'A broad household supply from which the semantic resolver may derive plausible ordinary, inexpensive food, nonalcoholic drink, basic medicine, and cooking ingredients. It does not authorize luxury, rare, specialty, hazardous, or implausibly abundant items.'
      ELSE description
    END,
    units_remaining = CASE
      WHEN name ILIKE '%kitchen%' OR name ILIKE '%provision%'
        THEN GREATEST(units_remaining, 100000)
      ELSE units_remaining
    END,
    constraints = CASE
      WHEN name ILIKE '%kitchen%' OR name ILIKE '%provision%'
        THEN '[
          "ordinary household consumables only",
          "derive semantics from the player request and scene context",
          "no luxury rare specialty or hazardous substances without separate authority",
          "maximum five units per action",
          "this is an ambient possibility source, not a fixed item catalogue"
        ]'::jsonb
      ELSE constraints
    END,
    state = CASE
      WHEN name ILIKE '%kitchen%' OR name ILIKE '%provision%'
        THEN COALESCE(state, '{}'::jsonb) || '{
          "sourcePolicy":"generic-household-provisions-v2",
          "renewableDuringPrototype":true,
          "semanticCatalog":false,
          "minimumOperationalUnits":100000
        }'::jsonb
      ELSE state
    END,
    updated_at = now()
WHERE visibility = 'player_known'
  AND (
    name ILIKE '%kitchen%'
    OR name ILIKE '%provision%'
    OR description ILIKE '%kitchen%'
    OR description ILIKE '%provision%'
  );
