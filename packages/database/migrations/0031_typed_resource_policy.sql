-- Explicit resource-key authorization for AI-proposed lazy simulation mutations.

ALTER TABLE game.entity_simulation_policies
  ADD COLUMN IF NOT EXISTS resource_keys jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE game.entity_simulation_policies
  DROP CONSTRAINT IF EXISTS entity_simulation_policies_resource_keys_array_check;
ALTER TABLE game.entity_simulation_policies
  ADD CONSTRAINT entity_simulation_policies_resource_keys_array_check
  CHECK (jsonb_typeof(resource_keys) = 'array');
