import { createHash, randomUUID } from "node:crypto";
import { ActionResolutionDecisionSchema, SemanticActionFrameSchema } from "@nocturne/contracts";
import type {
  PersistentPlanStore,
  RelationshipStore,
  ScheduledWorkClaim,
  UniversalOperationExecutor,
  WorldScope,
} from "@nocturne/database";
import type { createDatabase } from "@nocturne/database";

export class ScheduledWorkServiceError extends Error {
  constructor(
    readonly code:
      "unsupported_kind" | "stale_state" | "superseded" | "target_missing" | "domain_rejection",
    message: string,
  ) {
    super(message);
    this.name = "ScheduledWorkServiceError";
  }
}

const deterministicIdempotency = (claim: ScheduledWorkClaim) =>
  `${claim.idempotencyKey}:resolve:${createHash("sha256")
    .update(claim.resolutionPolicy)
    .digest("hex")
    .slice(0, 16)}`;

export function createScheduledWorkService(dependencies: {
  database: ReturnType<typeof createDatabase>;
  executor: UniversalOperationExecutor;
  plans: PersistentPlanStore;
  relationships: RelationshipStore;
}) {
  async function requireScope(claim: ScheduledWorkClaim): Promise<WorldScope> {
    const userId = String(claim.payload.userId || "scheduled-system");
    return {
      worldId: claim.worldId,
      shardId: claim.shardId,
      userId,
      role: "operator",
      selectedCharacterId: null,
    };
  }

  async function completePlanStep(claim: ScheduledWorkClaim, eventId: string, receiptId?: string) {
    if (!claim.planId || !claim.stepId) return;
    await dependencies.plans.completeStep({
      scope: { worldId: claim.worldId, shardId: claim.shardId },
      planId: claim.planId,
      stepId: claim.stepId,
      outcomeGrade: "complete_success",
      resultEventId: eventId,
      resultReceiptId: receiptId,
    });
  }

  async function resolveMove(claim: ScheduledWorkClaim, scope: WorldScope) {
    const cohortId = typeof claim.payload.cohortId === "string" ? claim.payload.cohortId : null;
    let operations;
    if (cohortId) {
      operations = await dependencies.relationships.travelOperations({
        scope,
        cohortId,
        preconditionFactIds: [],
      });
    } else {
      const actorId = String(claim.payload.actorId || claim.subjectEntityIds[0] || "");
      const locationId = String(claim.payload.locationId || "");
      if (!actorId || !locationId) {
        throw new ScheduledWorkServiceError(
          "target_missing",
          "Scheduled movement is missing actor or destination.",
        );
      }
      const expectedVersion = claim.expectedVersions[actorId];
      operations = [
        {
          type: "move_entity" as const,
          entityRef: { kind: "existing" as const, entityId: actorId },
          locationRef: { kind: "existing" as const, entityId: locationId },
          ...(expectedVersion === undefined ? {} : { expectedVersion }),
          ...(typeof claim.payload.expectedLocationId === "string"
            ? {
                expectedLocationRef: {
                  kind: "existing" as const,
                  entityId: claim.payload.expectedLocationId,
                },
              }
            : {}),
          preconditionFactIds: [],
        },
      ];
    }
    const receipt = await dependencies.executor.execute({
      scope,
      authority: "scheduled",
      idempotencyKey: deterministicIdempotency(claim),
      sourcePlanId: claim.planId || undefined,
      sourceStepId: claim.stepId || undefined,
      declaredFactIds: [],
      branch: { operations },
      playerVisibleFacts: ["Scheduled travel completed."],
      hiddenFacts: [],
    });
    if (cohortId) {
      await dependencies.database.client`
        UPDATE game.travel_cohorts
        SET status = 'arrived', completed_at = now(), updated_at = now()
        WHERE cohort_id = ${cohortId}
          AND world_id = ${claim.worldId}
          AND shard_id = ${claim.shardId}
          AND status IN ('assembled', 'traveling')
      `;
      await dependencies.database.client`
        UPDATE game.travel_cohort_members
        SET status = 'arrived'
        WHERE cohort_id = ${cohortId} AND status = 'included'
      `;
    }
    await completePlanStep(claim, receipt.eventId, receipt.receiptId);
    if (claim.planId) {
      await dependencies.plans.satisfyExternalDependency({
        scope,
        planId: claim.planId,
        dependencyType: "after_arrival",
        eventId: receipt.eventId,
        matches: (parameters) => {
          const expectedDestination = parameters.destinationId;
          return (
            expectedDestination === undefined ||
            expectedDestination === claim.payload.locationId ||
            expectedDestination === claim.payload.destinationId
          );
        },
      });
    }
    return receipt;
  }

  async function resolveJailRelease(claim: ScheduledWorkClaim, scope: WorldScope) {
    const actorId = String(claim.payload.actorId || claim.subjectEntityIds[0] || "");
    if (!actorId) {
      throw new ScheduledWorkServiceError("target_missing", "Jail release is missing an actor.");
    }
    const expectedVersion = claim.expectedVersions[actorId];
    const receipt = await dependencies.executor.execute({
      scope,
      authority: "scheduled",
      idempotencyKey: deterministicIdempotency(claim),
      sourcePlanId: claim.planId || undefined,
      sourceStepId: claim.stepId || undefined,
      declaredFactIds: [],
      branch: {
        operations: [
          {
            type: "set_state_value",
            entityRef: { kind: "existing", entityId: actorId },
            path: ["status"],
            value: "active",
            ...(expectedVersion === undefined ? {} : { expectedVersion }),
            preconditionFactIds: [],
          },
          {
            type: "adjust_resource",
            entityRef: { kind: "existing", entityId: actorId },
            resource: "heat",
            delta: -20,
            minimum: 0,
            maximum: 100,
            preconditionFactIds: [],
          },
        ],
      },
      playerVisibleFacts: ["The scheduled detention period ended."],
      hiddenFacts: [],
    });
    await completePlanStep(claim, receipt.eventId, receipt.receiptId);
    return receipt;
  }

  async function resolveCraftComplete(claim: ScheduledWorkClaim) {
    const requestId = typeof claim.payload.requestId === "string" ? claim.payload.requestId : null;
    if (!requestId) {
      throw new ScheduledWorkServiceError(
        "target_missing",
        "Craft completion is missing a generated-content request.",
      );
    }
    const eventId = randomUUID();
    await dependencies.database.client.begin(async (sql) => {
      const existing = await sql<{ event_id: string }[]>`
        SELECT event_id
        FROM game.event_ledger
        WHERE world_id = ${claim.worldId}
          AND idempotency_key = ${deterministicIdempotency(claim)}
      `;
      if (existing[0]) return;
      const requests = await sql<{ validation_status: string }[]>`
        SELECT validation_status
        FROM game.generated_content_requests
        WHERE world_id = ${claim.worldId}
          AND request_id = ${requestId}
        FOR UPDATE
      `;
      if (!requests[0]) {
        throw new ScheduledWorkServiceError("target_missing", "Craft request not found.");
      }
      if (!["crafting", "ready"].includes(requests[0].validation_status)) {
        throw new ScheduledWorkServiceError(
          "stale_state",
          "Craft request is no longer waiting for completion.",
        );
      }
      await sql`
        INSERT INTO game.event_ledger (
          event_id, world_id, shard_id, idempotency_key, world_time,
          event_type, involved_entity_ids, payload
        ) VALUES (
          ${eventId}, ${claim.worldId}, ${claim.shardId},
          ${deterministicIdempotency(claim)}, now(), 'craft_completed',
          ${JSON.stringify(claim.subjectEntityIds)}::jsonb,
          ${JSON.stringify({ requestId, scheduleId: claim.scheduleId })}::jsonb
        )
      `;
      await sql`
        UPDATE game.generated_content_requests
        SET validation_status = 'ready', updated_at = now(), completed_at = COALESCE(completed_at, now())
        WHERE world_id = ${claim.worldId} AND request_id = ${requestId}
      `;
    });
    await completePlanStep(claim, eventId);
    return { eventId };
  }

  async function resolveSemanticAction(claim: ScheduledWorkClaim, scope: WorldScope) {
    const actorId = String(claim.payload.actorId || claim.subjectEntityIds[0] || "");
    if (!actorId) {
      throw new ScheduledWorkServiceError(
        "target_missing",
        "Timed semantic action is missing an actor.",
      );
    }
    const frame = SemanticActionFrameSchema.parse(claim.payload.frame);
    const resolution = ActionResolutionDecisionSchema.parse(claim.payload.resolution);
    if (frame.actorId !== actorId || resolution.mode !== "timed_task") {
      throw new ScheduledWorkServiceError(
        "domain_rejection",
        "Timed semantic action payload is inconsistent.",
      );
    }
    const expectedVersion = claim.expectedVersions[actorId];
    const receipt = await dependencies.executor.execute({
      scope,
      authority: "scheduled",
      actorId,
      idempotencyKey: deterministicIdempotency(claim),
      sourcePlanId: claim.planId || undefined,
      sourceStepId: claim.stepId || undefined,
      declaredFactIds: resolution.requiredFactIds,
      branch: {
        operations: [
          {
            type: "set_state_value",
            entityRef: { kind: "existing", entityId: actorId },
            path: ["activity", "last_completed_timed_action"],
            value: {
              actionType: frame.actionType,
              objective: frame.objective,
              resolutionMode: resolution.mode,
              completedAt: new Date().toISOString(),
            },
            ...(expectedVersion === undefined ? {} : { expectedVersion }),
            preconditionFactIds: resolution.requiredFactIds,
          },
        ],
      },
      playerVisibleFacts: [`You complete the timed action: ${frame.objective}.`],
      hiddenFacts: [],
    });
    await completePlanStep(claim, receipt.eventId, receipt.receiptId);
    if (claim.planId) {
      await dependencies.plans.satisfyExternalDependency({
        scope,
        planId: claim.planId,
        dependencyType: "after_time",
        eventId: receipt.eventId,
        matches: (parameters) =>
          parameters.scheduleId === claim.scheduleId || parameters.stepId === claim.stepId,
      });
    }
    return receipt;
  }

  async function resolve(claim: ScheduledWorkClaim) {
    const scope = await requireScope(claim);
    switch (claim.kind) {
      case "move":
      case "travel_arrival":
        return resolveMove(claim, scope);
      case "jail_release":
        return resolveJailRelease(claim, scope);
      case "craft_complete":
        return resolveCraftComplete(claim);
      case "semantic_action_completion":
        return resolveSemanticAction(claim, scope);
      default:
        throw new ScheduledWorkServiceError(
          "unsupported_kind",
          `Unsupported scheduled work kind: ${claim.kind}.`,
        );
    }
  }

  return { resolve };
}

export type ScheduledWorkService = ReturnType<typeof createScheduledWorkService>;
