-- A character selection belongs to a user IN A WORLD, not globally to the user.
-- The previous unique index on (user_id) prevented the same account from
-- selecting a different character in an isolated certification world.
-- Existing data already satisfies the weaker per-world constraint; maintain
-- the index name to preserve operations that inspect it by name.
DROP INDEX IF EXISTS game.player_characters_one_selected_per_user_uq;
CREATE UNIQUE INDEX player_characters_one_selected_per_user_uq
  ON game.player_characters(world_id, user_id)
  WHERE selected;
