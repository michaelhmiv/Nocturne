CREATE TABLE IF NOT EXISTS game.player_characters (
  user_id text NOT NULL,
  character_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  selected boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, character_instance_id),
  UNIQUE (character_instance_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS player_characters_one_selected_per_user_uq
  ON game.player_characters(user_id)
  WHERE selected;
CREATE INDEX IF NOT EXISTS player_characters_user_idx
  ON game.player_characters(user_id);

CREATE TABLE IF NOT EXISTS game.entity_relations (
  relation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  target_instance_id uuid NOT NULL REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  relation_type text NOT NULL,
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_instance_id, target_instance_id, relation_type)
);

CREATE INDEX IF NOT EXISTS entity_relations_source_idx
  ON game.entity_relations(source_instance_id, relation_type);
CREATE INDEX IF NOT EXISTS entity_relations_target_idx
  ON game.entity_relations(target_instance_id, relation_type);

CREATE TABLE IF NOT EXISTS game.residence_occupancies (
  residence_instance_id uuid PRIMARY KEY REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  character_instance_id uuid NOT NULL UNIQUE REFERENCES game.entity_instances(instance_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE INDEX IF NOT EXISTS residence_occupancies_user_idx
  ON game.residence_occupancies(user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'entity_instances_location_fk'
      AND conrelid = 'game.entity_instances'::regclass
  ) THEN
    ALTER TABLE game.entity_instances
      ADD CONSTRAINT entity_instances_location_fk
      FOREIGN KEY (location_id) REFERENCES game.entity_instances(instance_id)
      DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;
