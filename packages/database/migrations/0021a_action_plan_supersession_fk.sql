-- Permit atomic replacement of an active plan before the replacement row is inserted.
-- The FK is checked at transaction commit after both plan rows exist.

ALTER TABLE game.action_plans
  DROP CONSTRAINT IF EXISTS action_plans_superseded_by_plan_id_fkey;

ALTER TABLE game.action_plans
  ADD CONSTRAINT action_plans_superseded_by_plan_id_fkey
  FOREIGN KEY (superseded_by_plan_id)
  REFERENCES game.action_plans(plan_id)
  DEFERRABLE INITIALLY DEFERRED;
