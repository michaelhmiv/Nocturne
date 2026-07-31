-- Persistent natural-language entity-reference resolution audits.

CREATE TABLE IF NOT EXISTS game.entity_reference_resolutions (
  resolution_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES game.world_shards(shard_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  viewpoint_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id),
  command_hash text NOT NULL CHECK (command_hash ~ '^[a-f0-9]{64}$'),
  command_excerpt text NOT NULL,
  mention_order integer NOT NULL CHECK (mention_order > 0),
  mention_text text NOT NULL CHECK (btrim(mention_text) <> ''),
  mention_kind text NOT NULL CHECK (mention_kind IN (
    'proper_name', 'alias', 'description', 'pronoun', 'relationship',
    'location', 'ordinal', 'possessive', 'unknown'
  )),
  status text NOT NULL CHECK (status IN (
    'resolved', 'ambiguous', 'not_found', 'known_but_inaccessible',
    'known_but_location_unknown', 'stale_reference'
  )),
  selected_entity_id uuid REFERENCES game.entity_instances(instance_id),
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(candidates) = 'array'),
  confidence numeric(5,4) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  supporting_fact_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  requires_clarification boolean NOT NULL DEFAULT false,
  clarification_prompt text,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, command_hash, viewpoint_instance_id, mention_order),
  CHECK (
    (status = 'resolved' AND selected_entity_id IS NOT NULL)
    OR (status <> 'resolved' AND selected_entity_id IS NULL)
  ),
  CHECK ((requires_clarification = false) OR clarification_prompt IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS entity_reference_resolution_viewpoint_idx
  ON game.entity_reference_resolutions (
    world_id, shard_id, viewpoint_instance_id, created_at DESC
  );
CREATE INDEX IF NOT EXISTS entity_reference_resolution_entity_idx
  ON game.entity_reference_resolutions (
    world_id, selected_entity_id, created_at DESC
  )
  WHERE selected_entity_id IS NOT NULL;
