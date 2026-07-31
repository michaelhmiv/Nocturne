import { randomUUID } from "node:crypto";
import {
  PersistentActionPlanProposalSchema,
  PersistentActionPlanSchema,
  type PersistentActionPlan,
  type PersistentActionPlanProposal,
  type PersistentPlanStatus,
} from "@nocturne/contracts";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";
import type { WorldScope } from "./world-store.js";

export type PlanConflictDecision = "reject" | "cancel_existing" | "supersede_existing";

export class PersistentPlanStoreError extends Error {
  constructor(
    readonly code:
      | "active_plan_conflict"
      | "plan_not_found"
      | "step_not_found"
      | "stale_plan"
      | "invalid_transition"
      | "dependency_unsatisfied",
    message: string,
  ) {
    super(message);
    this.name = "PersistentPlanStoreError";
  }
}

const activeStatuses = [
  "planned",
  "running",
  "waiting_for_time",
  "waiting_for_world_event",
  "waiting_for_clarification",
  "blocked",
] as const;

const terminalStatuses = new Set<PersistentPlanStatus>([
  "completed",
  "partially_completed",
  "failed",
  "cancelled",
  "superseded",
]);

const legalPlanTransitions: Record<PersistentPlanStatus, Set<PersistentPlanStatus>> = {
  planned: new Set(["running", "cancelled", "superseded", "failed"]),
  running: new Set([
    "waiting_for_time",
    "waiting_for_world_event",
    "waiting_for_clarification",
    "blocked",
    "completed",
    "partially_completed",
    "failed",
    "cancelled",
    "superseded",
  ]),
  waiting_for_time: new Set(["running", "failed", "cancelled", "superseded"]),
  waiting_for_world_event: new Set(["running", "blocked", "failed", "cancelled", "superseded"]),
  waiting_for_clarification: new Set(["running", "cancelled", "superseded", "failed"]),
  blocked: new Set(["running", "failed", "cancelled", "superseded"]),
  completed: new Set(),
  partially_completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  superseded: new Set(),
};

export function createPersistentPlanStore(database: ReturnType<typeof createDatabase>) {
  async function findActive(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    actorId: string;
  }) {
    const rows = await database.client<{ plan_id: string }[]>`
      SELECT plan_id
      FROM game.action_plans
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND actor_id = ${input.actorId}
        AND status = ANY(${activeStatuses}::text[])
      ORDER BY created_at DESC
      LIMIT 1
    `;
    return rows[0]?.plan_id || null;
  }

  async function read(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    planId: string;
  }): Promise<PersistentActionPlan> {
    const plans = await database.client<
      {
        plan_id: string;
        actor_id: string;
        status: PersistentPlanStatus;
        plan_version: string;
        active_step_id: string | null;
        exclusive_physical: boolean;
        created_at: Date;
        updated_at: Date;
      }[]
    >`
      SELECT plan_id, actor_id, status, plan_version::text, active_step_id,
             exclusive_physical, created_at, updated_at
      FROM game.action_plans
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND plan_id = ${input.planId}
    `;
    const plan = plans[0];
    if (!plan) throw new PersistentPlanStoreError("plan_not_found", "Plan not found.");
    const steps = await database.client<
      {
        step_id: string;
        step_order: number;
        step_kind: string;
        description: string;
        status: PersistentActionPlan["steps"][number]["status"];
        idempotency_key: string;
        waiting_reason: string | null;
        outcome_grade: string | null;
      }[]
    >`
      SELECT step_id, step_order, step_kind, description, status,
             idempotency_key, waiting_reason, outcome_grade
      FROM game.action_plan_steps
      WHERE plan_id = ${input.planId}
      ORDER BY step_order
    `;
    return PersistentActionPlanSchema.parse({
      planId: plan.plan_id,
      actorId: plan.actor_id,
      status: plan.status,
      planVersion: Number(plan.plan_version),
      activeStepId: plan.active_step_id,
      exclusivePhysical: plan.exclusive_physical,
      steps: steps.map((step) => ({
        stepId: step.step_id,
        order: step.step_order,
        kind: step.step_kind,
        description: step.description,
        status: step.status,
        idempotencyKey: step.idempotency_key,
        waitingReason: step.waiting_reason,
        outcomeGrade: step.outcome_grade,
      })),
      createdAt: plan.created_at.toISOString(),
      updatedAt: plan.updated_at.toISOString(),
    });
  }

  async function create(input: {
    scope: WorldScope;
    actorId: string;
    proposal: PersistentActionPlanProposal;
    idempotencyRoot: string;
    conflictDecision?: PlanConflictDecision;
    createdEventId?: string;
  }): Promise<PersistentActionPlan> {
    const proposal = PersistentActionPlanProposalSchema.parse(input.proposal);
    const planId = randomUUID();
    const stepIds = proposal.steps.map(() => randomUUID());
    const conflictDecision = input.conflictDecision || "reject";

    await database.client.begin(async (sql) => {
      await sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
      const existing = await sql<{ plan_id: string; status: PersistentPlanStatus }[]>`
        SELECT plan_id, status
        FROM game.action_plans
        WHERE world_id = ${input.scope.worldId}
          AND shard_id = ${input.scope.shardId}
          AND actor_id = ${input.actorId}
          AND exclusive_physical
          AND status = ANY(${activeStatuses}::text[])
        FOR UPDATE
      `;
      if (existing[0] && proposal.exclusivePhysical) {
        if (conflictDecision === "reject") {
          throw new PersistentPlanStoreError(
            "active_plan_conflict",
            "Actor already has an active exclusive physical plan.",
          );
        }
        const replacementStatus =
          conflictDecision === "supersede_existing" ? "superseded" : "cancelled";
        await sql`
          UPDATE game.action_plans
          SET status = ${replacementStatus},
              superseded_by_plan_id = CASE
                WHEN ${replacementStatus} = 'superseded' THEN ${planId}::uuid
                ELSE superseded_by_plan_id
              END,
              plan_version = plan_version + 1,
              updated_at = now(),
              completed_at = now()
          WHERE plan_id = ${existing[0].plan_id}
        `;
        await sql`
          UPDATE game.action_plan_steps
          SET status = CASE WHEN status IN ('completed', 'failed') THEN status ELSE ${replacementStatus} END,
              updated_at = now(),
              completed_at = COALESCE(completed_at, now())
          WHERE plan_id = ${existing[0].plan_id}
        `;
        await sql`
          INSERT INTO game.action_plan_events (
            world_id, plan_id, event_type, payload
          ) VALUES (
            ${input.scope.worldId}, ${existing[0].plan_id}, ${replacementStatus},
            ${json({ replacementPlanId: planId })}::jsonb
          )
        `;
      }

      await sql`
        INSERT INTO game.action_plans (
          plan_id, world_id, shard_id, user_id, actor_id, original_command,
          status, exclusive_physical, created_event_id, metadata
        ) VALUES (
          ${planId}, ${input.scope.worldId}, ${input.scope.shardId},
          ${input.scope.userId}, ${input.actorId}, ${proposal.originalCommand},
          'planned', ${proposal.exclusivePhysical}, ${input.createdEventId || null},
          ${json({ policyVersion: "persistent-plan-v1" })}::jsonb
        )
      `;
      for (const [index, step] of proposal.steps.entries()) {
        const stepId = stepIds[index]!;
        await sql`
          INSERT INTO game.action_plan_steps (
            step_id, plan_id, world_id, step_order, step_kind, description,
            status, idempotency_key, intent_payload
          ) VALUES (
            ${stepId}, ${planId}, ${input.scope.worldId}, ${step.order},
            ${step.kind}, ${step.description},
            ${step.order === 1 ? "ready" : "pending"},
            ${`${input.idempotencyRoot}:step:${step.order}`},
            ${json(step.intentPayload)}::jsonb
          )
        `;
        for (const entity of step.referencedEntities) {
          await sql`
            INSERT INTO game.action_plan_entities (
              world_id, plan_id, entity_id, role, reference_text,
              last_validated_version, last_validated_at
            ) VALUES (
              ${input.scope.worldId}, ${planId}, ${entity.entityId}, ${entity.role},
              ${entity.referenceText || null}, ${entity.expectedVersion ?? null}, now()
            )
            ON CONFLICT (plan_id, entity_id, role) DO UPDATE
            SET reference_text = COALESCE(EXCLUDED.reference_text, game.action_plan_entities.reference_text),
                last_validated_version = COALESCE(
                  EXCLUDED.last_validated_version,
                  game.action_plan_entities.last_validated_version
                ),
                last_validated_at = now()
          `;
        }
      }
      for (const dependency of proposal.dependencies) {
        await sql`
          INSERT INTO game.action_plan_dependencies (
            plan_id, step_id, depends_on_step_id, dependency_type, parameters
          ) VALUES (
            ${planId}, ${stepIds[dependency.stepOrder - 1]},
            ${dependency.dependsOnStepOrder ? stepIds[dependency.dependsOnStepOrder - 1] : null},
            ${dependency.dependencyType}, ${json(dependency.parameters)}::jsonb
          )
        `;
      }
      await sql`
        UPDATE game.action_plans
        SET active_step_id = ${stepIds[0]}, updated_at = now()
        WHERE plan_id = ${planId}
      `;
      await sql`
        INSERT INTO game.action_plan_events (
          world_id, plan_id, event_type, source_event_id, payload
        ) VALUES (
          ${input.scope.worldId}, ${planId}, 'plan_created',
          ${input.createdEventId || null},
          ${json({ stepCount: proposal.steps.length })}::jsonb
        )
      `;
    });
    return read({ scope: input.scope, planId });
  }

  async function transitionPlan(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    planId: string;
    expectedVersion: number;
    status: PersistentPlanStatus;
    activeStepId?: string | null;
    clarificationPrompt?: string;
    failureCode?: string;
    eventType?: string;
    sourceEventId?: string;
    payload?: Record<string, unknown>;
  }) {
    return database.client.begin(async (sql) => {
      const rows = await sql<{ status: PersistentPlanStatus; plan_version: string }[]>`
        SELECT status, plan_version::text
        FROM game.action_plans
        WHERE world_id = ${input.scope.worldId}
          AND shard_id = ${input.scope.shardId}
          AND plan_id = ${input.planId}
        FOR UPDATE
      `;
      const plan = rows[0];
      if (!plan) throw new PersistentPlanStoreError("plan_not_found", "Plan not found.");
      if (Number(plan.plan_version) !== input.expectedVersion) {
        throw new PersistentPlanStoreError("stale_plan", "Plan changed before transition.");
      }
      if (!legalPlanTransitions[plan.status].has(input.status)) {
        throw new PersistentPlanStoreError(
          "invalid_transition",
          `Plan cannot transition from ${plan.status} to ${input.status}.`,
        );
      }
      const terminal = terminalStatuses.has(input.status);
      const updated = await sql<{ plan_version: string }[]>`
        UPDATE game.action_plans
        SET status = ${input.status},
            active_step_id = ${input.activeStepId === undefined ? null : input.activeStepId},
            clarification_prompt = ${input.clarificationPrompt || null},
            failure_code = ${input.failureCode || null},
            plan_version = plan_version + 1,
            updated_at = now(),
            completed_at = CASE WHEN ${terminal} THEN now() ELSE NULL END
        WHERE plan_id = ${input.planId}
          AND plan_version = ${input.expectedVersion}
        RETURNING plan_version::text
      `;
      if (!updated[0]) throw new PersistentPlanStoreError("stale_plan", "Plan became stale.");
      await sql`
        INSERT INTO game.action_plan_events (
          world_id, plan_id, event_type, source_event_id, payload
        ) VALUES (
          ${input.scope.worldId}, ${input.planId},
          ${input.eventType || `plan_${input.status}`}, ${input.sourceEventId || null},
          ${json(input.payload || {})}::jsonb
        )
      `;
      return { planVersion: Number(updated[0].plan_version) };
    });
  }

  async function startReadyStep(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    planId: string;
  }) {
    return database.client.begin(async (sql) => {
      const steps = await sql<{ step_id: string; step_order: number; idempotency_key: string }[]>`
        SELECT step.step_id, step.step_order, step.idempotency_key
        FROM game.action_plan_steps step
        WHERE step.plan_id = ${input.planId}
          AND step.status = 'ready'
          AND NOT EXISTS (
            SELECT 1
            FROM game.action_plan_dependencies dependency
            WHERE dependency.step_id = step.step_id
              AND dependency.satisfied_at IS NULL
          )
        ORDER BY step.step_order
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;
      const step = steps[0];
      if (!step) return null;
      await sql`
        UPDATE game.action_plan_steps
        SET status = 'running', attempt_count = attempt_count + 1,
            started_at = COALESCE(started_at, now()), updated_at = now()
        WHERE step_id = ${step.step_id}
      `;
      await sql`
        UPDATE game.action_plans
        SET status = 'running', active_step_id = ${step.step_id},
            plan_version = plan_version + 1, updated_at = now()
        WHERE world_id = ${input.scope.worldId}
          AND shard_id = ${input.scope.shardId}
          AND plan_id = ${input.planId}
      `;
      return {
        stepId: step.step_id,
        stepOrder: step.step_order,
        idempotencyKey: step.idempotency_key,
      };
    });
  }

  async function completeStep(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    planId: string;
    stepId: string;
    outcomeGrade: string;
    resultEventId: string;
    resultReceiptId?: string;
  }) {
    return database.client.begin(async (sql) => {
      const steps = await sql<{ step_order: number; status: string }[]>`
        SELECT step_order, status
        FROM game.action_plan_steps
        WHERE plan_id = ${input.planId} AND step_id = ${input.stepId}
        FOR UPDATE
      `;
      if (!steps[0]) throw new PersistentPlanStoreError("step_not_found", "Plan step not found.");
      if (steps[0].status !== "running") {
        throw new PersistentPlanStoreError(
          "invalid_transition",
          "Only running steps can complete.",
        );
      }
      await sql`
        UPDATE game.action_plan_steps
        SET status = 'completed', outcome_grade = ${input.outcomeGrade},
            result_event_id = ${input.resultEventId},
            result_receipt_id = ${input.resultReceiptId || null},
            completed_at = now(), updated_at = now()
        WHERE step_id = ${input.stepId}
      `;
      await sql`
        UPDATE game.action_plan_dependencies
        SET satisfied_at = now(), satisfied_by_event_id = ${input.resultEventId}
        WHERE plan_id = ${input.planId}
          AND depends_on_step_id = ${input.stepId}
          AND dependency_type = 'after_step_completed'
          AND satisfied_at IS NULL
      `;
      if (["complete_success", "success_with_consequence"].includes(input.outcomeGrade)) {
        await sql`
          UPDATE game.action_plan_dependencies
          SET satisfied_at = now(), satisfied_by_event_id = ${input.resultEventId}
          WHERE plan_id = ${input.planId}
            AND depends_on_step_id = ${input.stepId}
            AND dependency_type = 'after_step_succeeded'
            AND satisfied_at IS NULL
        `;
      }
      await sql`
        UPDATE game.action_plan_steps next_step
        SET status = 'ready', updated_at = now()
        WHERE next_step.plan_id = ${input.planId}
          AND next_step.status = 'pending'
          AND NOT EXISTS (
            SELECT 1
            FROM game.action_plan_dependencies dependency
            WHERE dependency.step_id = next_step.step_id
              AND dependency.satisfied_at IS NULL
          )
      `;
      const remaining = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM game.action_plan_steps
        WHERE plan_id = ${input.planId}
          AND status NOT IN ('completed', 'cancelled', 'superseded')
      `;
      if (Number(remaining[0]?.count || 0) === 0) {
        await sql`
          UPDATE game.action_plans
          SET status = 'completed', active_step_id = NULL,
              plan_version = plan_version + 1, updated_at = now(), completed_at = now()
          WHERE plan_id = ${input.planId}
        `;
      } else {
        await sql`
          UPDATE game.action_plans
          SET active_step_id = NULL, plan_version = plan_version + 1, updated_at = now()
          WHERE plan_id = ${input.planId}
        `;
      }
      await sql`
        INSERT INTO game.action_plan_events (
          world_id, plan_id, step_id, event_type, source_event_id, payload
        ) VALUES (
          ${input.scope.worldId}, ${input.planId}, ${input.stepId},
          'step_completed', ${input.resultEventId},
          ${json({ outcomeGrade: input.outcomeGrade })}::jsonb
        )
      `;
    });
  }

  async function satisfyExternalDependency(input: {
    scope: Pick<WorldScope, "worldId">;
    planId: string;
    dependencyType:
      | "after_arrival"
      | "after_entity_present"
      | "after_item_acquired"
      | "after_time"
      | "after_event"
      | "after_clarification"
      | "after_access_granted";
    eventId: string;
    matches: (parameters: Record<string, unknown>) => boolean;
  }) {
    const rows = await database.client<
      { dependency_id: string; parameters: Record<string, unknown> }[]
    >`
      SELECT dependency_id, parameters
      FROM game.action_plan_dependencies
      WHERE plan_id = ${input.planId}
        AND dependency_type = ${input.dependencyType}
        AND satisfied_at IS NULL
      ORDER BY created_at
    `;
    const dependencyIds = rows
      .filter(({ parameters }) => input.matches(parameters))
      .map(({ dependency_id }) => dependency_id);
    if (dependencyIds.length === 0) return { satisfied: 0 };
    await database.client.begin(async (sql) => {
      await sql`
        UPDATE game.action_plan_dependencies
        SET satisfied_at = now(), satisfied_by_event_id = ${input.eventId}
        WHERE dependency_id = ANY(${dependencyIds}::uuid[])
      `;
      await sql`
        UPDATE game.action_plan_steps step
        SET status = 'ready', waiting_reason = NULL, updated_at = now()
        WHERE step.plan_id = ${input.planId}
          AND step.status IN ('pending', 'waiting')
          AND NOT EXISTS (
            SELECT 1 FROM game.action_plan_dependencies dependency
            WHERE dependency.step_id = step.step_id AND dependency.satisfied_at IS NULL
          )
      `;
      await sql`
        UPDATE game.action_plans
        SET status = 'running', plan_version = plan_version + 1, updated_at = now()
        WHERE plan_id = ${input.planId}
          AND status IN ('waiting_for_time', 'waiting_for_world_event', 'blocked')
      `;
      await sql`
        INSERT INTO game.action_plan_events (
          world_id, plan_id, event_type, source_event_id, payload
        ) VALUES (
          ${input.scope.worldId}, ${input.planId}, 'dependency_satisfied',
          ${input.eventId}, ${json({ dependencyType: input.dependencyType, dependencyIds })}::jsonb
        )
      `;
    });
    return { satisfied: dependencyIds.length };
  }

  return {
    findActive,
    read,
    create,
    transitionPlan,
    startReadyStep,
    completeStep,
    satisfyExternalDependency,
  };
}

export type PersistentPlanStore = ReturnType<typeof createPersistentPlanStore>;
