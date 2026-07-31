import { randomUUID } from "node:crypto";
import {
  OperatorRepairRequestSchema,
  OperatorRepairResultSchema,
  WorldInspectorEntitySchema,
  type OperatorRepairRequest,
  type OperatorRepairResult,
  type WorldInspectorEntity,
} from "../../contracts/src/world-inspector.js";
import { UniversalWorldOperationBranchSchema } from "../../contracts/src/world-operations.js";
import type { PersistentPlanStore } from "./persistent-plan-store.js";
import type { UniversalOperationExecutor } from "./universal-operation-executor.js";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";
import type { WorldScope } from "./world-store.js";

export class WorldInspectorStoreError extends Error {
  constructor(
    readonly code: "forbidden" | "entity_not_found" | "event_not_found" | "repair_failed",
    message: string,
  ) {
    super(message);
    this.name = "WorldInspectorStoreError";
  }
}

function requireOperator(scope: WorldScope) {
  if (!scope.role || !["owner", "operator"].includes(scope.role)) {
    throw new WorldInspectorStoreError("forbidden", "Operator world access is required.");
  }
}

export function createWorldInspectorStore(
  database: ReturnType<typeof createDatabase>,
  executor: UniversalOperationExecutor,
  plans: PersistentPlanStore,
) {
  async function inspect(input: {
    scope: WorldScope;
    entityId: string;
  }): Promise<WorldInspectorEntity> {
    requireOperator(input.scope);
    const rows = await database.client<
      {
        instance_id: string;
        definition_id: string;
        definition_type: string;
        name: string;
        world_id: string;
        shard_id: string;
        version: string;
        simulation_version: string;
        lifecycle_status: string;
        condition: number;
        location_id: string | null;
        owner_id: string | null;
        controller_id: string | null;
        state: Record<string, unknown>;
      }[]
    >`
      SELECT instance.instance_id, instance.definition_id,
             definition.definition_type, definition.name,
             instance.world_id, instance.shard_id, instance.version::text,
             instance.simulation_version::text, instance.lifecycle_status,
             instance.condition, instance.location_id, instance.owner_id,
             instance.controller_id, instance.state
      FROM game.entity_instances instance
      JOIN game.entity_definitions definition
        ON definition.definition_id = instance.definition_id
      WHERE instance.world_id = ${input.scope.worldId}
        AND instance.shard_id = ${input.scope.shardId}
        AND instance.instance_id = ${input.entityId}
    `;
    const entity = rows[0];
    if (!entity) {
      throw new WorldInspectorStoreError("entity_not_found", "Entity not found in active world.");
    }
    const [
      provenance,
      aliases,
      relations,
      recentEvents,
      activePlans,
      scheduledWork,
      simulationRuns,
      contextReasons,
    ] = await Promise.all([
      database.client`
          SELECT provenance_id, source_type, source_id, policy_version, input_hash,
                 created_event_id, payload, created_at
          FROM game.entity_provenance
          WHERE world_id = ${input.scope.worldId}
            AND entity_instance_id = ${input.entityId}
          ORDER BY created_at
          LIMIT 64
        `,
      database.client`
          SELECT alias_id, viewpoint_instance_id, alias_text, alias_type,
                 confidence, source_event_id, valid_from, valid_until
          FROM game.entity_aliases
          WHERE world_id = ${input.scope.worldId}
            AND entity_instance_id = ${input.entityId}
          ORDER BY valid_from DESC
          LIMIT 64
        `,
      database.client`
          SELECT relation_id, source_instance_id, target_instance_id,
                 relation_type, parameters, created_at, updated_at, valid_until
          FROM game.entity_relations
          WHERE world_id = ${input.scope.worldId}
            AND (
              source_instance_id = ${input.entityId}
              OR target_instance_id = ${input.entityId}
            )
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 256
        `,
      database.client`
          SELECT event_id, world_time, event_type, involved_entity_ids, payload,
                 source_intent_id, supersedes_event_id, created_at
          FROM game.event_ledger
          WHERE world_id = ${input.scope.worldId}
            AND shard_id = ${input.scope.shardId}
            AND involved_entity_ids ? ${input.entityId}
          ORDER BY world_time DESC, created_at DESC
          LIMIT 256
        `,
      database.client`
          SELECT plan_id, status, original_command, active_step_id,
                 plan_version, created_at, updated_at
          FROM game.action_plans
          WHERE world_id = ${input.scope.worldId}
            AND shard_id = ${input.scope.shardId}
            AND actor_id = ${input.entityId}
            AND status IN (
              'planned', 'running', 'waiting_for_time', 'waiting_for_world_event',
              'waiting_for_clarification', 'blocked'
            )
          ORDER BY created_at DESC
          LIMIT 64
        `,
      database.client`
          SELECT schedule_id, kind, status, resolves_at, plan_id, step_id,
                 subject_entity_ids, expected_versions, resolution_policy,
                 result_event_id, last_error_code
          FROM game.scheduled_actions
          WHERE world_id = ${input.scope.worldId}
            AND shard_id = ${input.scope.shardId}
            AND subject_entity_ids ? ${input.entityId}
          ORDER BY created_at DESC
          LIMIT 64
        `,
      database.client`
          SELECT run_id, policy_id, idempotency_key, elapsed_seconds,
                 starting_entity_version, starting_simulation_version,
                 status, error_code, result_event_id, created_at, completed_at
          FROM game.entity_simulation_runs
          WHERE world_id = ${input.scope.worldId}
            AND shard_id = ${input.scope.shardId}
            AND entity_instance_id = ${input.entityId}
          ORDER BY created_at DESC
          LIMIT 64
        `,
      database.client`
          SELECT compilation_id, viewpoint_instance_id, command_excerpt,
                 candidate_scores, selected_fact_ids, omitted_candidates,
                 policy_version, created_at
          FROM game.context_compilation_audits
          WHERE world_id = ${input.scope.worldId}
            AND candidate_scores @> ${json([{ entityId: input.entityId }])}::jsonb
          ORDER BY created_at DESC
          LIMIT 64
        `,
    ]);
    return WorldInspectorEntitySchema.parse({
      entityId: entity.instance_id,
      definitionId: entity.definition_id,
      definitionType: entity.definition_type,
      name: entity.name,
      worldId: entity.world_id,
      shardId: entity.shard_id,
      version: Number(entity.version),
      simulationVersion: Number(entity.simulation_version),
      lifecycleStatus: entity.lifecycle_status,
      condition: entity.condition,
      locationId: entity.location_id,
      ownerId: entity.owner_id,
      controllerId: entity.controller_id,
      state: entity.state || {},
      provenance,
      aliases,
      relations,
      recentEvents,
      activePlans,
      scheduledWork,
      simulationRuns,
      latestContextReasons: contextReasons,
    });
  }

  async function createOperatorAction(input: {
    scope: WorldScope;
    request: OperatorRepairRequest;
  }) {
    const operatorActionId = randomUUID();
    const targetEntityIds = (() => {
      switch (input.request.actionType) {
        case "relocate_entity":
          return [input.request.entityId, input.request.destinationId];
        case "repair_relation":
          return [input.request.sourceId, input.request.targetId];
        default:
          return [];
      }
    })();
    await database.client`
      INSERT INTO game.operator_actions (
        operator_action_id, world_id, shard_id, operator_user_id,
        action_type, target_entity_ids, target_plan_id, reason,
        request_payload, status
      ) VALUES (
        ${operatorActionId}, ${input.scope.worldId}, ${input.scope.shardId},
        ${input.scope.userId}, ${input.request.actionType},
        ${json(targetEntityIds)}::jsonb,
        ${input.request.actionType === "cancel_plan" ? input.request.planId : null},
        ${input.request.reason}, ${json(input.request)}::jsonb, 'pending'
      )
    `;
    return operatorActionId;
  }

  async function finishOperatorAction(input: {
    operatorActionId: string;
    status: "completed" | "failed";
    eventId?: string;
    receiptId?: string;
    errorCode?: string;
  }) {
    await database.client`
      UPDATE game.operator_actions
      SET status = ${input.status}, result_event_id = ${input.eventId || null},
          result_receipt_id = ${input.receiptId || null},
          error_code = ${input.errorCode || null}, completed_at = now()
      WHERE operator_action_id = ${input.operatorActionId}
    `;
  }

  async function repair(input: {
    scope: WorldScope;
    request: OperatorRepairRequest;
  }): Promise<OperatorRepairResult> {
    requireOperator(input.scope);
    const request = OperatorRepairRequestSchema.parse(input.request);
    const operatorActionId = await createOperatorAction({ scope: input.scope, request });
    try {
      if (request.actionType === "toggle_runtime_feature") {
        const eventId = randomUUID();
        await database.client.begin(async (sql) => {
          await sql`
            INSERT INTO game.event_ledger (
              event_id, world_id, shard_id, idempotency_key, world_time,
              event_type, involved_entity_ids, payload
            ) VALUES (
              ${eventId}, ${input.scope.worldId}, ${input.scope.shardId},
              ${`operator:${operatorActionId}`}, now(), 'runtime_feature_changed',
              '[]'::jsonb,
              ${json({
                featureKey: request.featureKey,
                enabled: request.enabled,
                configuration: request.configuration,
                reason: request.reason,
              })}::jsonb
            )
          `;
          await sql`
            INSERT INTO game.runtime_features (
              world_id, feature_key, enabled, configuration, updated_by, updated_at
            ) VALUES (
              ${input.scope.worldId}, ${request.featureKey}, ${request.enabled},
              ${json(request.configuration)}::jsonb, ${input.scope.userId}, now()
            )
            ON CONFLICT (world_id, feature_key) DO UPDATE
            SET enabled = EXCLUDED.enabled,
                configuration = EXCLUDED.configuration,
                updated_by = EXCLUDED.updated_by,
                updated_at = now()
          `;
        });
        await finishOperatorAction({ operatorActionId, status: "completed", eventId });
        return OperatorRepairResultSchema.parse({
          operatorActionId,
          status: "completed",
          eventId,
        });
      }

      if (request.actionType === "cancel_plan") {
        const plan = await plans.read({ scope: input.scope, planId: request.planId });
        await plans.transitionPlan({
          scope: input.scope,
          planId: request.planId,
          expectedVersion: plan.planVersion,
          status: "cancelled",
          eventType: "operator_cancelled_plan",
          payload: { operatorActionId, reason: request.reason },
        });
        const eventId = randomUUID();
        await database.client`
          INSERT INTO game.event_ledger (
            event_id, world_id, shard_id, idempotency_key, world_time,
            event_type, involved_entity_ids, payload
          ) VALUES (
            ${eventId}, ${input.scope.worldId}, ${input.scope.shardId},
            ${`operator:${operatorActionId}`}, now(), 'operator_plan_cancelled',
            '[]'::jsonb,
            ${json({ planId: request.planId, reason: request.reason })}::jsonb
          )
        `;
        await finishOperatorAction({ operatorActionId, status: "completed", eventId });
        return OperatorRepairResultSchema.parse({
          operatorActionId,
          status: "completed",
          eventId,
        });
      }

      const branch = (() => {
        switch (request.actionType) {
          case "relocate_entity":
            return UniversalWorldOperationBranchSchema.parse({
              operations: [
                {
                  type: "move_entity",
                  entityRef: { kind: "existing", entityId: request.entityId },
                  locationRef: { kind: "existing", entityId: request.destinationId },
                  expectedVersion: request.expectedVersion,
                  preconditionFactIds: [],
                },
              ],
            });
          case "repair_relation":
            return UniversalWorldOperationBranchSchema.parse({
              operations: [
                request.mode === "set"
                  ? {
                      type: "set_relation",
                      sourceRef: { kind: "existing", entityId: request.sourceId },
                      targetRef: { kind: "existing", entityId: request.targetId },
                      relationType: request.relationType,
                      parameters: request.parameters,
                      preconditionFactIds: [],
                    }
                  : {
                      type: "remove_relation",
                      sourceRef: { kind: "existing", entityId: request.sourceId },
                      targetRef: { kind: "existing", entityId: request.targetId },
                      relationType: request.relationType,
                      preconditionFactIds: [],
                    },
              ],
            });
          case "compensating_event":
            return UniversalWorldOperationBranchSchema.parse({
              operations: request.operations,
            });
          default:
            throw new WorldInspectorStoreError("repair_failed", "Unsupported repair action.");
        }
      })();
      const receipt = await executor.execute({
        scope: input.scope,
        authority: "operator",
        idempotencyKey: `operator:${operatorActionId}`,
        declaredFactIds: [],
        branch,
        playerVisibleFacts: [],
        hiddenFacts: [`Operator repair: ${request.reason}`],
      });
      if (request.actionType === "compensating_event") {
        const original = await database.client`
          SELECT 1
          FROM game.event_ledger
          WHERE world_id = ${input.scope.worldId}
            AND event_id = ${request.originalEventId}
        `;
        if (!original[0]) {
          throw new WorldInspectorStoreError("event_not_found", "Original event not found.");
        }
        await database.client`
          INSERT INTO game.compensating_event_links (
            compensating_event_id, original_event_id, operator_action_id,
            compensation_kind, explanation
          ) VALUES (
            ${receipt.eventId}, ${request.originalEventId}, ${operatorActionId},
            'operator_repair', ${request.explanation}
          )
        `;
      }
      await finishOperatorAction({
        operatorActionId,
        status: "completed",
        eventId: receipt.eventId,
        receiptId: receipt.receiptId,
      });
      return OperatorRepairResultSchema.parse({
        operatorActionId,
        status: "completed",
        eventId: receipt.eventId,
        receiptId: receipt.receiptId,
      });
    } catch (error) {
      await finishOperatorAction({
        operatorActionId,
        status: "failed",
        errorCode: error instanceof WorldInspectorStoreError ? error.code : "repair_failed",
      }).catch(() => {});
      throw error;
    }
  }

  return { inspect, repair };
}

export type WorldInspectorStore = ReturnType<typeof createWorldInspectorStore>;
