-- Generic AI-derived semantic profiles and ambient asset pools.
-- These primitives are intentionally not food-specific and can support any
-- arbitrary item or mundane scene resource that later systems need to resolve.

CREATE TABLE IF NOT EXISTS game.entity_semantic_profiles (
  profile_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  profile_type text NOT NULL,
  policy_version text NOT NULL,
  input_hash text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_instance_id, profile_type, input_hash)
);

CREATE INDEX IF NOT EXISTS entity_semantic_profiles_entity_idx
  ON game.entity_semantic_profiles (entity_instance_id, profile_type, created_at DESC);

CREATE TABLE IF NOT EXISTS game.ambient_asset_pools (
  pool_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  container_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL,
  units_remaining numeric(12, 3) NOT NULL DEFAULT 0 CHECK (units_remaining >= 0),
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  visibility text NOT NULL DEFAULT 'player_known'
    CHECK (visibility IN ('player_known', 'authoritative_hidden')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (container_instance_id, name)
);

CREATE INDEX IF NOT EXISTS ambient_asset_pools_container_idx
  ON game.ambient_asset_pools (container_instance_id, visibility)
  WHERE units_remaining > 0;

-- Unit 3B begins with an abstract, sparse provision pool. The AI may turn a
-- unit into a plausible ordinary substance, but the pool does not predefine a
-- food list and explicitly cannot satisfy specialty requests such as cake.
INSERT INTO game.ambient_asset_pools (
  pool_id,
  container_instance_id,
  name,
  description,
  units_remaining,
  constraints,
  state
) VALUES (
  '70000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000005',
  'Sparse kitchen provisions',
  'A few ordinary, inexpensive, shelf-stable kitchen provisions appropriate to a recently rented low-cost apartment.',
  3,
  '[
    "Materialized items must be mundane and inexpensive.",
    "No specialty, luxury, celebratory, rare, or freshly prepared foods may be assumed.",
    "The pool cannot produce an item merely because the player names it."
  ]'::jsonb,
  '{"replenishes":false,"quality":"ordinary","abundance":"sparse"}'::jsonb
) ON CONFLICT (pool_id) DO NOTHING;
