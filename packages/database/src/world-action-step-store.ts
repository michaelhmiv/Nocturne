import type { createDatabase } from "./index.js";
import type { WorldScope } from "./world-store.js";

export type ExecutableWorldActionStep = {
  stepId: string;
  planId: string;
  order: number;
  kind: string;
  description: string;
  status: string;
  idempotencyKey: string;
  intentPayload: Record<string, unknown>;
  resolvedReferences: Record<string, unknown>;
  expectedVersions: Record<string, number>;
};

export function createWorldActionStepStore(database: ReturnType<typeof createDatabase>) {
  async function readExecutable(input: {
    scope: Pick<WorldScope, "worldId">;
    planId: string;
    stepId: string;
  }): Promise<ExecutableWorldActionStep | null> {
    const rows = await database.client<
      {
        step_id: string;
        plan_id: string;
        step_order: number;
        step_kind: string;
        description: string;
        status: string;
        idempotency_key: string;
        intent_payload: Record<string, unknown>;
        resolved_references: Record<string, unknown>;
        expected_versions: Record<string, number>;
      }[]
    >`
      SELECT step_id, plan_id, step_order, step_kind, description, status,
             idempotency_key, intent_payload, resolved_references, expected_versions
      FROM game.action_plan_steps
      WHERE world_id = ${input.scope.worldId}
        AND plan_id = ${input.planId}
        AND step_id = ${input.stepId}
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      stepId: row.step_id,
      planId: row.plan_id,
      order: row.step_order,
      kind: row.step_kind,
      description: row.description,
      status: row.status,
      idempotencyKey: row.idempotency_key,
      intentPayload: row.intent_payload || {},
      resolvedReferences: row.resolved_references || {},
      expectedVersions: row.expected_versions || {},
    };
  }

  async function markWaiting(input: {
    scope: Pick<WorldScope, "worldId">;
    planId: string;
    stepId: string;
    reason: string;
    scheduleId?: string;
  }) {
    const rows = await database.client<{ step_id: string }[]>`
      UPDATE game.action_plan_steps
      SET status = 'waiting', waiting_reason = ${input.reason}, updated_at = now()
      WHERE world_id = ${input.scope.worldId}
        AND plan_id = ${input.planId}
        AND step_id = ${input.stepId}
        AND status = 'running'
      RETURNING step_id
    `;
    if (!rows[0]) throw new Error("Only a running plan step can enter waiting state.");
    if (input.scheduleId) {
      await database.client`
        UPDATE game.scheduled_actions
        SET plan_id = ${input.planId}, step_id = ${input.stepId}, updated_at = now()
        WHERE world_id = ${input.scope.worldId}
          AND schedule_id = ${input.scheduleId}
      `;
    }
  }

  async function failStep(input: {
    scope: Pick<WorldScope, "worldId">;
    planId: string;
    stepId: string;
    failureCode: string;
    eventId?: string;
  }) {
    const rows = await database.client<{ step_id: string }[]>`
      UPDATE game.action_plan_steps
      SET status = 'failed', failure_code = ${input.failureCode},
          result_event_id = ${input.eventId || null}, completed_at = now(), updated_at = now()
      WHERE world_id = ${input.scope.worldId}
        AND plan_id = ${input.planId}
        AND step_id = ${input.stepId}
        AND status IN ('ready', 'running', 'waiting')
      RETURNING step_id
    `;
    if (!rows[0]) throw new Error("Plan step is not fail-able in its current state.");
  }

  return { readExecutable, markWaiting, failStep };
}

export type WorldActionStepStore = ReturnType<typeof createWorldActionStepStore>;
