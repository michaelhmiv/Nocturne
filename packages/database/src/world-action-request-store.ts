import { createHash, randomUUID } from "node:crypto";
import type { WorldActionPlayerSafeResult } from "@nocturne/contracts";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";
import type { WorldScope } from "./world-store.js";

export type WorldActionRequestStatus =
  | "reserved"
  | "compiling_context"
  | "resolving_references"
  | "planning"
  | "waiting_for_clarification"
  | "executing"
  | "waiting"
  | "completed"
  | "failed"
  | "cancelled"
  | "superseded";

export type ReservedWorldActionRequest = {
  requestId: string;
  status: WorldActionRequestStatus;
  requestHash: string;
  planId: string | null;
  playerSafeResult: WorldActionPlayerSafeResult | null;
  created: boolean;
};

export class WorldActionRequestStoreError extends Error {
  constructor(
    readonly code: "idempotency_conflict" | "request_not_found" | "invalid_transition",
    message: string,
  ) {
    super(message);
    this.name = "WorldActionRequestStoreError";
  }
}

const terminal = new Set<WorldActionRequestStatus>([
  "completed",
  "failed",
  "cancelled",
  "superseded",
]);

const legalTransitions: Record<WorldActionRequestStatus, Set<WorldActionRequestStatus>> = {
  reserved: new Set(["compiling_context", "cancelled", "failed"]),
  compiling_context: new Set(["resolving_references", "failed", "cancelled"]),
  resolving_references: new Set(["planning", "waiting_for_clarification", "failed", "cancelled"]),
  planning: new Set(["executing", "waiting_for_clarification", "failed", "cancelled"]),
  waiting_for_clarification: new Set(["planning", "cancelled", "superseded", "failed"]),
  executing: new Set(["waiting", "completed", "failed", "cancelled", "superseded"]),
  waiting: new Set(["executing", "completed", "failed", "cancelled", "superseded"]),
  completed: new Set(),
  failed: new Set(),
  cancelled: new Set(),
  superseded: new Set(),
};

const requestHash = (input: { actorId: string; command: string }) =>
  createHash("sha256").update(JSON.stringify(input)).digest("hex");

export function createWorldActionRequestStore(database: ReturnType<typeof createDatabase>) {
  async function reserve(input: {
    scope: WorldScope;
    actorId: string;
    command: string;
    idempotencyKey: string;
  }): Promise<ReservedWorldActionRequest> {
    const hash = requestHash({ actorId: input.actorId, command: input.command });
    const requestId = randomUUID();
    const rows = await database.client<
      {
        request_id: string;
        request_hash: string;
        status: WorldActionRequestStatus;
        plan_id: string | null;
        player_safe_result: WorldActionPlayerSafeResult | null;
        inserted: boolean;
      }[]
    >`
      INSERT INTO game.world_action_requests (
        request_id, world_id, shard_id, user_id, actor_id,
        idempotency_key, command, request_hash, status
      ) VALUES (
        ${requestId}, ${input.scope.worldId}, ${input.scope.shardId},
        ${input.scope.userId}, ${input.actorId}, ${input.idempotencyKey},
        ${input.command}, ${hash}, 'reserved'
      )
      ON CONFLICT (world_id, idempotency_key) DO UPDATE
      SET idempotency_key = EXCLUDED.idempotency_key
      RETURNING request_id, request_hash, status, plan_id, player_safe_result,
                (xmax = 0) AS inserted
    `;
    const row = rows[0];
    if (!row) throw new WorldActionRequestStoreError("request_not_found", "Reservation failed.");
    if (row.request_hash !== hash) {
      throw new WorldActionRequestStoreError(
        "idempotency_conflict",
        "Idempotency key was used for another world action.",
      );
    }
    return {
      requestId: row.request_id,
      status: row.status,
      requestHash: row.request_hash,
      planId: row.plan_id,
      playerSafeResult: row.player_safe_result,
      created: row.inserted,
    };
  }

  async function transition(input: {
    scope: Pick<WorldScope, "worldId">;
    requestId: string;
    expectedStatus: WorldActionRequestStatus | WorldActionRequestStatus[];
    status: WorldActionRequestStatus;
    contextCompilationId?: string;
    planId?: string;
    authoritativeResult?: Record<string, unknown>;
    playerSafeResult?: WorldActionPlayerSafeResult;
    errorCode?: string;
  }) {
    const expected = Array.isArray(input.expectedStatus)
      ? input.expectedStatus
      : [input.expectedStatus];
    for (const current of expected) {
      if (!legalTransitions[current].has(input.status) && current !== input.status) {
        throw new WorldActionRequestStoreError(
          "invalid_transition",
          `World action cannot transition from ${current} to ${input.status}.`,
        );
      }
    }
    const rows = await database.client<{ status: WorldActionRequestStatus }[]>`
      UPDATE game.world_action_requests
      SET status = ${input.status},
          context_compilation_id = COALESCE(${input.contextCompilationId || null}, context_compilation_id),
          plan_id = COALESCE(${input.planId || null}, plan_id),
          authoritative_result = COALESCE(${
            input.authoritativeResult ? json(input.authoritativeResult) : null
          }::jsonb, authoritative_result),
          player_safe_result = COALESCE(${
            input.playerSafeResult ? json(input.playerSafeResult) : null
          }::jsonb, player_safe_result),
          error_code = ${input.errorCode || null},
          updated_at = now(),
          completed_at = CASE WHEN ${terminal.has(input.status)} THEN now() ELSE NULL END
      WHERE world_id = ${input.scope.worldId}
        AND request_id = ${input.requestId}
        AND status = ANY(${expected}::text[])
      RETURNING status
    `;
    if (!rows[0]) {
      throw new WorldActionRequestStoreError(
        "invalid_transition",
        "World action request status changed concurrently.",
      );
    }
    return rows[0].status;
  }

  async function stage(input: {
    requestId: string;
    order: number;
    type: string;
    status: "started" | "completed" | "failed" | "waiting" | "skipped";
    inputSummary?: Record<string, unknown>;
    outputSummary?: Record<string, unknown>;
  }) {
    const completed = input.status !== "started";
    await database.client`
      INSERT INTO game.world_action_execution_stages (
        stage_id, request_id, stage_order, stage_type, status,
        input_summary, output_summary, completed_at
      ) VALUES (
        ${randomUUID()}, ${input.requestId}, ${input.order}, ${input.type},
        ${input.status}, ${json(input.inputSummary || {})}::jsonb,
        ${json(input.outputSummary || {})}::jsonb,
        ${completed ? new Date().toISOString() : null}
      )
      ON CONFLICT (request_id, stage_order) DO UPDATE
      SET stage_type = EXCLUDED.stage_type,
          status = EXCLUDED.status,
          input_summary = EXCLUDED.input_summary,
          output_summary = EXCLUDED.output_summary,
          completed_at = EXCLUDED.completed_at
    `;
  }

  async function get(input: { scope: Pick<WorldScope, "worldId">; requestId: string }) {
    const rows = await database.client<
      {
        request_id: string;
        status: WorldActionRequestStatus;
        plan_id: string | null;
        player_safe_result: WorldActionPlayerSafeResult | null;
        error_code: string | null;
      }[]
    >`
      SELECT request_id, status, plan_id, player_safe_result, error_code
      FROM game.world_action_requests
      WHERE world_id = ${input.scope.worldId} AND request_id = ${input.requestId}
    `;
    if (!rows[0]) throw new WorldActionRequestStoreError("request_not_found", "Request not found.");
    return rows[0];
  }

  return { reserve, transition, stage, get };
}

export type WorldActionRequestStore = ReturnType<typeof createWorldActionRequestStore>;
