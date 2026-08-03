-- Keep action-plan interruption atomic across plans, steps, schedules, and requests.

ALTER TABLE game.scheduled_actions
  DROP CONSTRAINT IF EXISTS scheduled_actions_status_check;
ALTER TABLE game.scheduled_actions
  ADD CONSTRAINT scheduled_actions_status_check
  CHECK (status IN ('pending', 'retrying', 'resolving', 'resolved', 'failed', 'cancelled'));

CREATE OR REPLACE FUNCTION game.cleanup_terminal_action_plan()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status NOT IN ('cancelled', 'superseded')
     OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  UPDATE game.action_plan_steps
  SET status = NEW.status,
      waiting_reason = COALESCE(
        waiting_reason,
        CASE
          WHEN NEW.status = 'superseded' THEN 'The action was superseded by a newer plan.'
          ELSE 'The action was cancelled.'
        END
      ),
      updated_at = now(),
      completed_at = COALESCE(completed_at, now())
  WHERE plan_id = NEW.plan_id
    AND status NOT IN ('completed', 'failed', 'cancelled', 'superseded');

  UPDATE game.scheduled_actions
  SET status = 'cancelled',
      cancellation_reason = COALESCE(
        cancellation_reason,
        CASE
          WHEN NEW.status = 'superseded' THEN 'Source action plan was superseded.'
          ELSE 'Source action plan was cancelled.'
        END
      ),
      worker_id = NULL,
      lease_expires_at = NULL,
      retryable = false,
      updated_at = now(),
      completed_at = COALESCE(completed_at, now())
  WHERE plan_id = NEW.plan_id
    AND status IN ('pending', 'retrying', 'resolving');

  UPDATE game.world_action_requests
  SET status = NEW.status,
      error_code = CASE
        WHEN NEW.status = 'superseded' THEN 'plan_superseded'
        ELSE 'plan_cancelled'
      END,
      updated_at = now(),
      completed_at = COALESCE(completed_at, now())
  WHERE plan_id = NEW.plan_id
    AND status NOT IN ('completed', 'failed', 'cancelled', 'superseded');

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS action_plan_terminal_cleanup ON game.action_plans;
CREATE TRIGGER action_plan_terminal_cleanup
AFTER UPDATE OF status ON game.action_plans
FOR EACH ROW
EXECUTE FUNCTION game.cleanup_terminal_action_plan();

-- Repair plans that became terminal before the cleanup trigger existed.
UPDATE game.action_plan_steps step
SET status = plan.status,
    waiting_reason = COALESCE(
      step.waiting_reason,
      CASE
        WHEN plan.status = 'superseded' THEN 'The action was superseded by a newer plan.'
        ELSE 'The action was cancelled.'
      END
    ),
    updated_at = now(),
    completed_at = COALESCE(step.completed_at, now())
FROM game.action_plans plan
WHERE step.plan_id = plan.plan_id
  AND plan.status IN ('cancelled', 'superseded')
  AND step.status NOT IN ('completed', 'failed', 'cancelled', 'superseded');

UPDATE game.scheduled_actions action
SET status = 'cancelled',
    cancellation_reason = COALESCE(
      action.cancellation_reason,
      CASE
        WHEN plan.status = 'superseded' THEN 'Source action plan was superseded.'
        ELSE 'Source action plan was cancelled.'
      END
    ),
    worker_id = NULL,
    lease_expires_at = NULL,
    retryable = false,
    updated_at = now(),
    completed_at = COALESCE(action.completed_at, now())
FROM game.action_plans plan
WHERE action.plan_id = plan.plan_id
  AND plan.status IN ('cancelled', 'superseded')
  AND action.status IN ('pending', 'retrying', 'resolving');

UPDATE game.world_action_requests request
SET status = plan.status,
    error_code = CASE
      WHEN plan.status = 'superseded' THEN 'plan_superseded'
      ELSE 'plan_cancelled'
    END,
    updated_at = now(),
    completed_at = COALESCE(request.completed_at, now())
FROM game.action_plans plan
WHERE request.plan_id = plan.plan_id
  AND plan.status IN ('cancelled', 'superseded')
  AND request.status NOT IN ('completed', 'failed', 'cancelled', 'superseded');
