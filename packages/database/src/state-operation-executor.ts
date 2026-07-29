import { randomUUID } from "node:crypto";
import {
  ConversationStateOperationSchema,
  MAX_CONVERSATION_FACTS,
  MAX_STATE_OPERATIONS,
  type ConversationStateOperation,
} from "@nocturne/contracts";
import type { TransactionSql } from "postgres";
import { createAuthoritativeContextStore } from "./context-store.js";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";

export class StateOperationExecutorError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "turn_not_found"
      | "invalid_turn"
      | "forbidden"
      | "unmet_precondition"
      | "target_not_found"
      | "unsupported_operation",
    message: string,
  ) {
    super(message);
    this.name = "StateOperationExecutorError";
  }
}

export type ConversationStateOperationInput = {
  userId: string;
  viewpointId: string;
  turnId: string;
  eventId: string;
  leaseUpdatedAt?: Date;
  declaredFactIds: string[];
  operations: ConversationStateOperation[];
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const supported = new Set<ConversationStateOperation["type"]>([
  "move_entity",
  "create_information_asset",
]);

function parseInput(input: ConversationStateOperationInput) {
  if (
    !input.userId ||
    input.userId.trim() !== input.userId ||
    !uuidPattern.test(input.viewpointId) ||
    !uuidPattern.test(input.turnId) ||
    !uuidPattern.test(input.eventId) ||
    (input.leaseUpdatedAt !== undefined &&
      (!(input.leaseUpdatedAt instanceof Date) ||
        !Number.isFinite(input.leaseUpdatedAt.getTime()))) ||
    input.declaredFactIds.length > MAX_CONVERSATION_FACTS ||
    new Set(input.declaredFactIds).size !== input.declaredFactIds.length ||
    input.declaredFactIds.some(
      (factId) =>
        typeof factId !== "string" ||
        factId.trim() !== factId ||
        factId.length === 0 ||
        factId.length > 128,
    )
  ) {
    throw new StateOperationExecutorError("invalid_input", "Invalid state operation input.");
  }
  let operations: ConversationStateOperation[];
  try {
    operations = input.operations.map((operation) =>
      ConversationStateOperationSchema.parse(operation),
    );
  } catch {
    throw new StateOperationExecutorError("invalid_input", "Invalid state operation.");
  }
  if (operations.length > MAX_STATE_OPERATIONS) {
    throw new StateOperationExecutorError("invalid_input", "Too many state operations.");
  }
  const unsupported = operations.find((operation) => !supported.has(operation.type));
  if (unsupported) {
    throw new StateOperationExecutorError(
      "unsupported_operation",
      `Unsupported state operation: ${unsupported.type}.`,
    );
  }
  return operations;
}

async function requireMutableEntity(sql: TransactionSql, entityId: string, viewpointId: string) {
  const rows = await sql<
    { instance_id: string; owner_id: string | null; controller_id: string | null }[]
  >`
    SELECT instance_id, owner_id, controller_id
    FROM game.entity_instances
    WHERE instance_id = ${entityId}
    FOR UPDATE
  `;
  const entity = rows[0];
  if (!entity)
    throw new StateOperationExecutorError("target_not_found", "Operation target not found.");
  if (
    entity.instance_id !== viewpointId &&
    entity.owner_id !== viewpointId &&
    entity.controller_id !== viewpointId
  ) {
    throw new StateOperationExecutorError(
      "forbidden",
      "Operation target is not controlled by the viewpoint.",
    );
  }
}

async function requireEntity(sql: TransactionSql, entityId: string) {
  const rows = await sql`SELECT 1 FROM game.entity_instances WHERE instance_id = ${entityId}`;
  if (!rows[0])
    throw new StateOperationExecutorError("target_not_found", "Operation target not found.");
}

export async function executeConversationStateOperations(
  database: ReturnType<typeof createDatabase>,
  input: ConversationStateOperationInput,
): Promise<{ eventId: string }> {
  const operations = parseInput(input);
  const idempotencyKey = `conversation-turn:${input.turnId}:state-operations`;
  const payload = {
    turnId: input.turnId,
    viewpointId: input.viewpointId,
    declaredFactIds: input.declaredFactIds,
    operations,
  };
  const execution = database.client.begin(async (sql) => {
    await sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
    const turns = await sql<{ status: string; updatedAt: string }[]>`
      SELECT status, updated_at::text AS "updatedAt"
      FROM game.conversation_turns
      WHERE turn_id = ${input.turnId} AND user_id = ${input.userId}
      FOR UPDATE
    `;
    if (!turns[0])
      throw new StateOperationExecutorError("turn_not_found", "Conversation turn not found.");
    if (turns[0].status !== "pending") {
      throw new StateOperationExecutorError("invalid_turn", "Conversation turn is not pending.");
    }
    if (
      input.leaseUpdatedAt &&
      new Date(turns[0].updatedAt).getTime() !== input.leaseUpdatedAt.getTime()
    ) {
      throw new StateOperationExecutorError(
        "invalid_turn",
        "Conversation turn lease was superseded.",
      );
    }

    const collisions = await sql`
      SELECT event_id
      FROM game.event_ledger
      WHERE event_id = ${input.eventId} OR idempotency_key = ${idempotencyKey}
      FOR UPDATE
    `;
    if (collisions[0]) {
      const exact = await sql`
        SELECT 1 FROM game.event_ledger
        WHERE event_id = ${input.eventId}
          AND idempotency_key = ${idempotencyKey}
          AND event_type = 'conversation_state_operations_applied'
          AND payload = ${json(payload)}
      `;
      if (exact[0]) return { eventId: input.eventId };
      throw new StateOperationExecutorError("invalid_input", "State operation replay conflicts.");
    }

    await requireMutableEntity(sql, input.viewpointId, input.viewpointId);
    const context = await createAuthoritativeContextStore(database).buildContext(input.userId, sql);
    if (context.viewpointId !== input.viewpointId) {
      throw new StateOperationExecutorError(
        "forbidden",
        "Viewpoint is not the selected controlled character.",
      );
    }
    const declared = new Set(input.declaredFactIds);
    const currentFacts = [...context.playerKnownFacts, ...context.authoritativeHiddenFacts];
    const current = new Set(currentFacts.map(({ factId }) => factId));
    const subjectReferenceClaims = new Set([
      "selected_character",
      "current_location",
      "place_ancestor",
      "held_item",
      "observed_entity",
    ]);
    const citesCurrentEntity = (
      operation: ConversationStateOperation,
      entityId: string,
      allowsClaim: (claim: string) => boolean,
    ) =>
      currentFacts.some(
        (fact) =>
          operation.preconditionFactIds.includes(fact.factId) &&
          fact.value === entityId &&
          allowsClaim(fact.claim),
      );
    for (const operation of operations) {
      for (const factId of operation.preconditionFactIds) {
        if (!declared.has(factId) || !current.has(factId)) {
          throw new StateOperationExecutorError(
            "unmet_precondition",
            "State operation precondition is undeclared or stale.",
          );
        }
      }
    }

    for (const operation of operations) {
      if (operation.type === "move_entity") {
        await requireMutableEntity(sql, operation.entityId, input.viewpointId);
        if (
          !citesCurrentEntity(
            operation,
            operation.locationId,
            (claim) => claim === "relationship.can_enter",
          )
        ) {
          throw new StateOperationExecutorError(
            "unmet_precondition",
            "Movement destination is not authorized by a current cited fact.",
          );
        }
        const destinations = await sql`
          SELECT 1
          FROM game.entity_instances instance
          JOIN game.entity_definitions definition
            ON definition.definition_id = instance.definition_id
          WHERE instance.instance_id = ${operation.locationId}
            AND definition.definition_type IN ('location', 'residence')
        `;
        if (!destinations[0]) {
          throw new StateOperationExecutorError(
            "target_not_found",
            "Movement destination not found.",
          );
        }
      } else if (operation.type === "create_information_asset") {
        await requireMutableEntity(sql, operation.holderId, input.viewpointId);
        if (operation.subjectId) {
          if (
            !citesCurrentEntity(
              operation,
              operation.subjectId,
              (claim) => subjectReferenceClaims.has(claim) || claim.startsWith("relationship."),
            )
          ) {
            throw new StateOperationExecutorError(
              "unmet_precondition",
              "Information subject is not authorized by a current cited fact.",
            );
          }
          await requireEntity(sql, operation.subjectId);
        }
      }
    }

    const involvedEntityIds = [
      input.viewpointId,
      ...operations.flatMap((operation) =>
        operation.type === "move_entity"
          ? [operation.entityId, operation.locationId]
          : operation.type === "create_information_asset"
            ? [operation.holderId, ...(operation.subjectId ? [operation.subjectId] : [])]
            : [],
      ),
    ].filter((value, index, values) => values.indexOf(value) === index);
    await sql`
      INSERT INTO game.event_ledger (
        event_id, idempotency_key, world_time, event_type, involved_entity_ids, payload
      ) VALUES (
        ${input.eventId}, ${idempotencyKey}, now(),
        'conversation_state_operations_applied', ${json(involvedEntityIds)},
        ${json(payload)}
      )
    `;

    for (const operation of operations) {
      if (operation.type === "move_entity") {
        const moved = await sql`
          UPDATE game.entity_instances
          SET location_id = ${operation.locationId}, updated_at = now()
          WHERE instance_id = ${operation.entityId}
          RETURNING instance_id
        `;
        if (moved.length !== 1) {
          throw new StateOperationExecutorError(
            "target_not_found",
            "Movement target became stale.",
          );
        }
      } else if (operation.type === "create_information_asset") {
        await sql`
          INSERT INTO game.information_assets (
            information_id, holder_instance_id, subject_instance_id, content,
            confidence, truth_status, source_event_id
          ) VALUES (
            ${randomUUID()}, ${operation.holderId}, ${operation.subjectId ?? null}, ${operation.content},
            ${operation.confidenceBasisPoints / 10_000}, ${operation.truthStatus}, ${input.eventId}
          )
        `;
      }
    }
    return { eventId: input.eventId };
  });
  return execution.catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "40001") {
      throw new StateOperationExecutorError(
        "unmet_precondition",
        "State changed while applying this turn.",
      );
    }
    throw error;
  });
}
