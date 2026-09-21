-- A character selection belongs to a user IN A WORLD, not globally to the user.
-- The previous unique index on (user_id) prevented the same account from
-- selecting a different character in an isolated certification world.
-- Existing data already satisfies the weaker per-world constraint; maintain
-- the index name to preserve operations that inspect it by name.
DROP INDEX IF EXISTS game.player_characters_one_selected_per_user_uq;
CREATE UNIQUE INDEX player_characters_one_selected_per_user_uq
  ON game.player_characters(world_id, user_id)
  WHERE selected;

-- Guard the historical hard-coded Ashdown allocator AT THE DATABASE BOUNDARY.
-- The store rejects foreign-world actors, but direct SQL callers must not be
-- able to place a certification-world character in the public starter building.
ALTER FUNCTION game.provision_starter_residence(text, uuid, text)
  RENAME TO provision_starter_residence_default_world_impl;

CREATE FUNCTION game.provision_starter_residence(
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
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM game.player_characters pc
    JOIN game.entity_instances actor
      ON actor.instance_id = pc.character_instance_id
    WHERE pc.user_id = p_user_id
      AND pc.character_instance_id = p_character_id
      AND pc.world_id = '00000000-0000-4000-8000-000000000001'::uuid
      AND actor.world_id = pc.world_id
      AND actor.shard_id = '00000000-0000-4000-8000-000000000002'::uuid
  ) THEN
    RAISE EXCEPTION 'Character is not controlled in the default world and shard.'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT *
    FROM game.provision_starter_residence_default_world_impl(
      p_user_id, p_character_id, p_idempotency_key
    );
END;
$$;
