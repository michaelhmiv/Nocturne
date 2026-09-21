import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_SHARD_ID,
  DEFAULT_WORLD_ID,
  createDatabase,
  createPersistentPlanStore,
  createUniversalOperationExecutor,
  createWorldActionStepStore,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const url = process.env.DATABASE_URL;
const describePostgres = url ? describe : describe.skip;

describePostgres(
  "scheduled plan completion and retry invariants (PostgreSQL)",
  () => {
    const db = createDatabase(url!);
    const plans = createPersistentPlanStore(db);
    const steps = createWorldActionStepStore(db);
    const executor = createUniversalOperationExecutor(db);
    const actorId = randomUUID();
    const definitionId = `scheduled_plan_actor_${randomUUID()}`;
    const scope = {
      worldId: DEFAULT_WORLD_ID,
      shardId: DEFAULT_SHARD_ID,
      userId: "scheduled-plan-completion-test",
      role: "player" as const,
      selectedCharacterId: actorId,
    };

    beforeAll(async () => {
      await execFileAsync("pnpm", ["exec", "tsx", "src/migrate.ts"], {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, DATABASE_URL: url },
      });
      await db.client`
      INSERT INTO game.entity_definitions
        (definition_id, definition_type, name, concept_summary, lifecycle_status, world_id)
      VALUES (${definitionId}, 'character', 'Timed Test Actor',
              'Scheduler retry test actor', 'approved', ${scope.worldId})
    `;
      await db.client`
      INSERT INTO game.entity_instances
        (instance_id, definition_id, world_id, shard_id, state)
      VALUES (${actorId}, ${definitionId}, ${scope.worldId}, ${scope.shardId}, '{}'::jsonb)
    `;
      await db.client`
      INSERT INTO game.player_characters
        (user_id, world_id, character_instance_id, selected)
      VALUES (${scope.userId}, ${scope.worldId}, ${actorId}, true)
    `;
    });

    afterAll(() => db.close());

    async function setupWaiting() {
      const root = `schedule-integration:${randomUUID()}`;
      const plan = await plans.create({
        scope,
        actorId,
        idempotencyRoot: root,
        proposal: {
          originalCommand: "Stretch for one second",
          exclusivePhysical: false,
          steps: [
            {
              order: 1,
              kind: "interact",
              description: "Stretch",
              intentPayload: {},
              referencedEntities: [],
            },
          ],
          dependencies: [],
        },
      });
      const started = await plans.startReadyStep({
        scope,
        planId: plan.planId,
      });
      expect(started).toBeTruthy();
      const stepId = started!.stepId;
      const scheduled = await executor.execute({
        scope,
        authority: "player",
        actorId,
        sourcePlanId: plan.planId,
        sourceStepId: stepId,
        idempotencyKey: `${root}:schedule`,
        declaredFactIds: [],
        branch: {
          operations: [
            {
              type: "schedule_timed_work",
              symbol: "work",
              kind: "semantic_action_completion",
              subjectRefs: [{ kind: "existing", entityId: actorId }],
              description: "Stretch",
              durationSeconds: 1,
              payload: { actorId },
              expectedVersions: {},
              preconditionFactIds: [],
            },
          ],
        },
        playerVisibleFacts: ["Stretching starts."],
        hiddenFacts: [],
      });
      const scheduleId = scheduled.symbolMap.work!;
      expect(scheduleId).toBeTruthy();
      await steps.markWaiting({
        scope,
        planId: plan.planId,
        stepId,
        scheduleId,
        reason: "Waiting for elapsed time",
      });
      const current = await plans.read({ scope, planId: plan.planId });
      await plans.transitionPlan({
        scope,
        planId: plan.planId,
        expectedVersion: current.planVersion,
        status: "waiting_for_time",
        activeStepId: stepId,
      });
      return { planId: plan.planId, stepId, scheduleId, root };
    }

    async function committedResult(
      ids: Awaited<ReturnType<typeof setupWaiting>>,
    ) {
      const operation = {
        type: "set_state_value" as const,
        entityRef: { kind: "existing" as const, entityId: actorId },
        path: ["last_completed_timed_action"],
        value: { actionType: "stretch", scheduleId: ids.scheduleId },
        preconditionFactIds: [],
      };
      const input = {
        scope,
        authority: "scheduled" as const,
        actorId,
        idempotencyKey: `${ids.root}:resolve`,
        sourcePlanId: ids.planId,
        sourceStepId: ids.stepId,
        declaredFactIds: [],
        branch: { operations: [operation] },
        playerVisibleFacts: ["Stretch finished."],
        hiddenFacts: [],
      };
      const first = await executor.execute(input);
      const second = await executor.execute(input);
      expect(second.eventId).toBe(first.eventId);
      expect(second.idempotentReplay).toBe(true);
      const [actor] = await db.client<{ state: Record<string, unknown> }[]>`
      SELECT state FROM game.entity_instances
      WHERE world_id = ${scope.worldId}
        AND shard_id = ${scope.shardId}
        AND instance_id = ${actorId}
    `;
      expect(actor?.state.last_completed_timed_action).toEqual({
        actionType: "stretch",
        scheduleId: ids.scheduleId,
      });
      return first;
    }

    it("only completes a waiting step for its due, scoped, leased schedule and does so once", async () => {
      const ids = await setupWaiting();
      const receipt = await committedResult(ids);
      const completion = {
        scope,
        planId: ids.planId,
        stepId: ids.stepId,
        outcomeGrade: "complete_success",
        resultEventId: receipt.eventId,
        resultReceiptId: receipt.receiptId,
        scheduleId: ids.scheduleId,
      };
      await expect(plans.completeStep(completion)).rejects.toMatchObject({
        code: "invalid_transition",
      });
      await db.client`
      UPDATE game.scheduled_actions
      SET resolves_at = now() - interval '1 second',
          status = 'resolving', worker_id = 'scheduled-plan-integration',
          attempt_count = 1, lease_expires_at = now() + interval '60 seconds'
      WHERE schedule_id = ${ids.scheduleId}
    `;
      await expect(
        plans.completeStep({ ...completion, scheduleId: undefined }),
      ).rejects.toMatchObject({
        code: "invalid_transition",
      });
      await expect(
        plans.completeStep({
          ...completion,
          scope: { ...scope, worldId: randomUUID() },
        }),
      ).rejects.toMatchObject({ code: "step_not_found" });
      await plans.completeStep(completion);
      await plans.completeStep(completion);
      expect((await plans.read({ scope, planId: ids.planId })).status).toBe(
        "completed",
      );
      const events = await db.client<{ count: number }[]>`
      SELECT count(*)::int AS count FROM game.action_plan_events
      WHERE plan_id = ${ids.planId} AND event_type = 'step_completed'
    `;
      expect(events[0]?.count).toBe(1);
      await expect(
        plans.completeStep({
          ...completion,
          resultEventId: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: "invalid_transition" });
    });

    it("does not complete a cancelled waiting plan even with a claimed schedule", async () => {
      const ids = await setupWaiting();
      const receipt = await committedResult(ids);
      await db.client`
      UPDATE game.scheduled_actions
      SET resolves_at = now() - interval '1 second',
          status = 'resolving', worker_id = 'scheduled-plan-integration',
          attempt_count = 1, lease_expires_at = now() + interval '60 seconds'
      WHERE schedule_id = ${ids.scheduleId}
    `;
      const current = await plans.read({ scope, planId: ids.planId });
      await plans.transitionPlan({
        scope,
        planId: ids.planId,
        expectedVersion: current.planVersion,
        status: "cancelled",
      });
      await expect(
        plans.completeStep({
          scope,
          planId: ids.planId,
          stepId: ids.stepId,
          scheduleId: ids.scheduleId,
          outcomeGrade: "complete_success",
          resultEventId: receipt.eventId,
          resultReceiptId: receipt.receiptId,
        }),
      ).rejects.toMatchObject({ code: "invalid_transition" });
    });
  },
);
