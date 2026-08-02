import { OperatorDashboardSchema, type OperatorDashboard } from "@nocturne/contracts";
import type { createDatabase } from "./index.js";
import type { WorldScope } from "./world-store.js";

const objectOrNull = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const iso = (value: Date | string | null) =>
  value ? (value instanceof Date ? value : new Date(value)).toISOString() : null;

type OperatorStageRow = {
  stage_id: string;
  request_id: string;
  stage_order: number;
  stage_type: string;
  status: "started" | "completed" | "failed" | "waiting" | "skipped";
  input_summary: Record<string, unknown>;
  output_summary: Record<string, unknown>;
  started_at: Date;
  completed_at: Date | null;
};

export function createOperatorDashboardStore(database: ReturnType<typeof createDatabase>) {
  async function build(input: {
    scope: WorldScope;
    actorId: string;
    limit?: number;
  }): Promise<OperatorDashboard> {
    const actorRows = await database.client<{ instance_id: string }[]>`
      SELECT instance_id
      FROM game.entity_instances
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND instance_id = ${input.actorId}
      LIMIT 1
    `;
    if (!actorRows[0]) throw new Error("Actor does not exist in this world and shard.");

    const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
    const requests = await database.client<
      {
        request_id: string;
        command: string;
        status: string;
        error_code: string | null;
        plan_id: string | null;
        context_compilation_id: string | null;
        authoritative_result: Record<string, unknown> | null;
        player_safe_result: Record<string, unknown> | null;
        created_at: Date;
        updated_at: Date;
        completed_at: Date | null;
      }[]
    >`
      SELECT request_id, command, status, error_code, plan_id,
             context_compilation_id, authoritative_result, player_safe_result,
             created_at, updated_at, completed_at
      FROM game.world_action_requests
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND actor_id = ${input.actorId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;

    const requestIds = requests.map((request) => request.request_id);
    const stages: OperatorStageRow[] = requestIds.length
      ? await database.client<OperatorStageRow[]>`
          SELECT stage_id, request_id, stage_order, stage_type, status,
                 input_summary, output_summary, started_at, completed_at
          FROM game.world_action_execution_stages
          WHERE request_id = ANY(${database.client.array(requestIds, 2950)})
          ORDER BY request_id, stage_order
        `
      : [];
    const stagesByRequest = new Map<string, OperatorStageRow[]>();
    for (const stage of stages) {
      const current = stagesByRequest.get(stage.request_id) || [];
      current.push(stage);
      stagesByRequest.set(stage.request_id, current);
    }

    const handlers = await database.client<
      {
        action_kind: string;
        handler_version: string;
        authority_mode: string;
        supports_state_change: boolean;
        enabled: boolean;
        description: string;
      }[]
    >`
      SELECT action_kind, handler_version, authority_mode,
             supports_state_change, enabled, description
      FROM game.world_action_handler_registry
      ORDER BY action_kind
    `;

    return OperatorDashboardSchema.parse({
      actorId: input.actorId,
      traces: requests.map((request) => ({
        requestId: request.request_id,
        command: request.command,
        status: request.status,
        errorCode: request.error_code,
        planId: request.plan_id,
        contextCompilationId: request.context_compilation_id,
        authoritativeResult: objectOrNull(request.authoritative_result),
        playerSafeResult: objectOrNull(request.player_safe_result),
        createdAt: request.created_at.toISOString(),
        updatedAt: request.updated_at.toISOString(),
        completedAt: iso(request.completed_at),
        stages: (stagesByRequest.get(request.request_id) || []).map((stage) => ({
          stageId: stage.stage_id,
          order: stage.stage_order,
          type: stage.stage_type,
          status: stage.status,
          inputSummary: objectOrNull(stage.input_summary) || {},
          outputSummary: objectOrNull(stage.output_summary) || {},
          startedAt: stage.started_at.toISOString(),
          completedAt: iso(stage.completed_at),
        })),
      })),
      handlers: handlers.map((handler) => ({
        actionKind: handler.action_kind,
        handlerVersion: handler.handler_version,
        authorityMode: handler.authority_mode,
        supportsStateChange: handler.supports_state_change,
        enabled: handler.enabled,
        description: handler.description,
      })),
      generatedAt: new Date().toISOString(),
    });
  }

  return { build };
}

export type OperatorDashboardStore = ReturnType<typeof createOperatorDashboardStore>;
