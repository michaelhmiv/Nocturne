-- Normalized relationship mechanics, exclusive physical relations, and travel cohorts.

CREATE TABLE IF NOT EXISTS game.relation_semantic_families (
  relation_type text PRIMARY KEY CHECK (relation_type ~ '^[a-z][a-z0-9_]{0,63}$'),
  family text NOT NULL CHECK (family IN (
    'knowledge', 'physical', 'possession', 'ownership', 'control', 'custody',
    'accompaniment', 'social', 'hostility', 'residence', 'access', 'assignment',
    'organization', 'other'
  )),
  inverse_relation_type text,
  exclusive_for_source boolean NOT NULL DEFAULT false,
  implies_effective_location boolean NOT NULL DEFAULT false,
  mechanically_active boolean NOT NULL DEFAULT true,
  default_visibility text NOT NULL DEFAULT 'authoritative_hidden'
    CHECK (default_visibility IN ('player_known', 'authoritative_hidden')),
  parameter_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO game.relation_semantic_families (
  relation_type, family, inverse_relation_type, exclusive_for_source,
  implies_effective_location, default_visibility, description
) VALUES
  ('observed', 'knowledge', 'observed_by', false, false, 'player_known', 'The source has observed the target.'),
  ('knows_about', 'knowledge', 'known_by', false, false, 'player_known', 'The source retains knowledge of the target.'),
  ('following', 'accompaniment', 'followed_by', true, false, 'player_known', 'The source is currently following the target.'),
  ('accompanying', 'accompaniment', 'accompanied_by', true, false, 'player_known', 'The source is currently traveling or acting with the target.'),
  ('owned_by', 'ownership', 'owns', true, false, 'player_known', 'The source is legally or socially owned by the target.'),
  ('possessed_by', 'possession', 'possesses', true, true, 'player_known', 'The source is physically possessed by the target.'),
  ('controlled_by', 'control', 'controls', true, false, 'authoritative_hidden', 'The source is mechanically controlled by the target.'),
  ('in_custody_of', 'custody', 'has_custody_of', true, true, 'player_known', 'The source is in the custody of the target.'),
  ('contained_in', 'physical', 'contains', true, true, 'player_known', 'The source is physically contained in the target.'),
  ('located_within', 'physical', 'contains_location', true, true, 'player_known', 'A location is physically within another location.'),
  ('resides_at', 'residence', 'residence_of', true, false, 'player_known', 'The source ordinarily resides at the target.'),
  ('assigned_to', 'assignment', 'has_assigned', true, false, 'player_known', 'The source is assigned to the target.'),
  ('tethered_to', 'physical', 'tethers', true, false, 'player_known', 'The source is physically tethered to the target.'),
  ('guarding', 'assignment', 'guarded_by', true, false, 'player_known', 'The source is guarding the target.'),
  ('trusts', 'social', 'trusted_by', false, false, 'authoritative_hidden', 'The source trusts the target to a bounded degree.'),
  ('fears', 'social', 'feared_by', false, false, 'authoritative_hidden', 'The source fears the target to a bounded degree.'),
  ('hostile_to', 'hostility', 'hostile_from', false, false, 'authoritative_hidden', 'The source is hostile toward the target.'),
  ('allied_with', 'social', 'allied_with', false, false, 'player_known', 'The entities are allied.'),
  ('has_access_to', 'access', 'accessible_by', false, false, 'player_known', 'The source has access to the target resource or location.')
ON CONFLICT (relation_type) DO UPDATE
SET family = EXCLUDED.family,
    inverse_relation_type = EXCLUDED.inverse_relation_type,
    exclusive_for_source = EXCLUDED.exclusive_for_source,
    implies_effective_location = EXCLUDED.implies_effective_location,
    default_visibility = EXCLUDED.default_visibility,
    description = EXCLUDED.description,
    updated_at = now();

ALTER TABLE game.entity_relations
  ADD COLUMN IF NOT EXISTS world_event_id uuid REFERENCES game.event_ledger(event_id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS valid_until timestamptz;

CREATE INDEX IF NOT EXISTS entity_relations_active_source_idx
  ON game.entity_relations (world_id, source_instance_id, relation_type, updated_at DESC)
  WHERE valid_until IS NULL;
CREATE INDEX IF NOT EXISTS entity_relations_active_target_idx
  ON game.entity_relations (world_id, target_instance_id, relation_type, updated_at DESC)
  WHERE valid_until IS NULL;

CREATE TABLE IF NOT EXISTS game.travel_cohorts (
  cohort_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL REFERENCES game.worlds(world_id) ON DELETE CASCADE,
  shard_id uuid NOT NULL REFERENCES game.world_shards(shard_id) ON DELETE CASCADE,
  leader_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id),
  destination_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id),
  status text NOT NULL DEFAULT 'assembled'
    CHECK (status IN ('assembled', 'traveling', 'arrived', 'separated', 'cancelled', 'failed')),
  source_event_id uuid REFERENCES game.event_ledger(event_id),
  schedule_id uuid REFERENCES game.scheduled_actions(schedule_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS game.travel_cohort_members (
  cohort_id uuid NOT NULL REFERENCES game.travel_cohorts(cohort_id) ON DELETE CASCADE,
  entity_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id),
  role text NOT NULL CHECK (role IN (
    'leader', 'vehicle', 'passenger', 'carried', 'following', 'restrained', 'companion'
  )),
  required boolean NOT NULL DEFAULT true,
  expected_version bigint NOT NULL,
  expected_location_id uuid REFERENCES game.entity_instances(instance_id),
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'included'
    CHECK (status IN ('included', 'excluded', 'separated', 'arrived', 'failed')),
  PRIMARY KEY (cohort_id, entity_instance_id)
);

CREATE INDEX IF NOT EXISTS travel_cohorts_leader_idx
  ON game.travel_cohorts (world_id, shard_id, leader_instance_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS travel_cohort_members_entity_idx
  ON game.travel_cohort_members (entity_instance_id, status);
