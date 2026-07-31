-- Autonomous animal simulation may update only the animal's own bounded state,
-- condition, and accessible physical location. Relationship changes require a
-- separate authoritative interaction or scheduled world event.

UPDATE game.entity_simulation_policies
SET allowed_operation_types = '[
  "set_state_value",
  "remove_state_value",
  "set_condition",
  "adjust_condition",
  "move_entity"
]'::jsonb,
    updated_at = now()
WHERE policy_id = '72000000-0000-4000-8000-000000000001';
