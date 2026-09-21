import { WorldActionPlayerSafeResultSchema, type WorldActionPlayerSafeResult } from "@nocturne/contracts";
import type {
  PersistentPlanStore,
  WorldActionRequestStore,
  WorldScope,
  createDatabase,
} from "@nocturne/database";

export class ScheduledRequestFinalizerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScheduledRequestFinalizerError";
  }
}

/**
 * The worker commits a scheduled effect and completes its plan step; a separate
 * player request must also transition from WAITING to COMPLETED. Otherwise
 * replay and dashboards continue to present stale, in-progress narration.
 *
 * Only scoped, committed event receipts can contribute player-facing facts.
 * A failure after step completion is recoverable on the worker's idempotent
 * retry, without duplicating the mutation or step-completed plan event.
 */
export function createScheduledRequestFinalizer(dependencies: {
  database: ReturnType<typeof createDatabase>;
  plans: PersistentPlanStore;
  requests: WorldActionRequestStore;
}) {
  return async (input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    planId: string;
    stepId: string;
    actorId: string;
    eventId: string;
  }) => {
    const plan = await dependencies.plans.read({ scope: input.scope, planId: input.planId });
    if (plan.status !== "completed") return { terminalized: false };

    const [request] = await dependencies.database.client<
      {
        request_id: string;
        status: string;
        player_safe_result: WorldActionPlayerSafeResult | null;
      }[]
    >`
      SELECT request_id, status, player_safe_result
      FROM game.world_action_requests
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND plan_id = ${input.planId}
        AND actor_id = ${input.actorId}
      LIMIT 1
    `;
    if (!request) return { terminalized: false };

    const events = await dependencies.database.client<{ result_event_id: string }[]>`
      SELECT result_event_id
      FROM game.action_plan_steps
      WHERE world_id = ${input.scope.worldId}
        AND plan_id = ${input.planId}
        AND status = 'completed'
        AND result_event_id IS NOT NULL
      ORDER BY step_order
    `;
    const eventIds = events.map((row) => row.result_event_id);
    if (!eventIds.includes(input.eventId) || !eventIds.length) {
      throw new ScheduledRequestFinalizerError(
        "The scheduled result is not linked to the completed action plan.",
      );
    }

    if (request.status === "completed") {
      if (
        request.player_safe_result?.state !== "completed" ||
        !request.player_safe_result.eventIds.includes(input.eventId)
      ) {
        throw new ScheduledRequestFinalizerError(
          "The player request was already completed with a different result.",
        );
      }
      return { terminalized: true, idempotentReplay: true };
    }
    if (request.status !== "waiting") {
      throw new ScheduledRequestFinalizerError(
        "Only a waiting player request may finish from scheduled work.",
      );
    }

    const [event] = await dependencies.database.client<
      { payload: { playerVisibleFacts?: unknown } }[]
    >`
      SELECT payload FROM game.event_ledger
      WHERE event_id = ${input.eventId}
        AND world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
    `;
    if (!event) {
      throw new ScheduledRequestFinalizerError("Committed scheduled event is missing.");
    }
    const committedFacts = Array.isArray(event.payload.playerVisibleFacts)
      ? event.payload.playerVisibleFacts.filter(
          (fact): fact is string => typeof fact === "string" && Boolean(fact.trim()),
        )
      : [];
    const result = WorldActionPlayerSafeResultSchema.parse({
      state: "completed",
      requestId: request.request_id,
      plan,
      narration: committedFacts.join(" ") || "The scheduled work has completed.",
      eventIds,
    });
    await dependencies.requests.transition({
      scope: input.scope,
      requestId: request.request_id,
      expectedStatus: "waiting",
      status: "completed",
      planId: input.planId,
      authoritativeResult: { eventIds },
      playerSafeResult: result,
    });
    return { terminalized: true, idempotentReplay: false };
  };
}
