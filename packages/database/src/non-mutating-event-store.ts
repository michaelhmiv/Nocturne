import { createHash, randomUUID } from "node:crypto";
import {
  UniversalEventTypeSchema,
  isNonMutatingEventType,
  type UniversalEventType,
} from "@nocturne/contracts";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";
import type { WorldScope } from "./world-store.js";

export type NonMutatingEventInput = {
  scope: WorldScope;
  actorId: string;
  idempotencyKey: string;
  eventType: UniversalEventType;
  sourcePlanId?: string;
  sourceStepId?: string;
  payload: Record<string, unknown>;
  playerVisibleFacts?: string[];
  hiddenFacts?: string[];
};

export type NonMutatingEventReceipt = {
  eventId: string;
  receiptId: string;
  eventType: UniversalEventType;
  idempotentReplay: boolean;
};

export class NonMutatingEventError extends Error {
  constructor(
    readonly code: "invalid_event_type" | "idempotency_conflict",
    message: string,
  ) {
    super(message);
    this.name = "NonMutatingEventError";
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

function requestHash(input: NonMutatingEventInput) {
  return createHash("sha256")
    .update(
      JSON.stringify(
        canonicalize({
          actorId: input.actorId,
          eventType: input.eventType,
          sourcePlanId: input.sourcePlanId ?? null,
          sourceStepId: input.sourceStepId ?? null,
          payload: input.payload,
          playerVisibleFacts: input.playerVisibleFacts ?? [],
          hiddenFacts: input.hiddenFacts ?? [],
        }),
      ),
    )
    .digest("hex");
}

export function createNonMutatingEventStore(database: ReturnType<typeof createDatabase>) {
  async function record(input: NonMutatingEventInput): Promise<NonMutatingEventReceipt> {
    const eventType = UniversalEventTypeSchema.parse(input.eventType);
    if (!isNonMutatingEventType(eventType)) {
      throw new NonMutatingEventError(
        "invalid_event_type",
        `${eventType} is not a non-mutating action event type.`,
      );
    }
    const hash = requestHash(input);
    const playerVisibleFacts = input.playerVisibleFacts ?? [];
    const hiddenFacts = input.hiddenFacts ?? [];

    return database.client.begin(async (transaction) => {
      const existing = await transaction<
        Array<{
          receipt_id: string;
          event_id: string;
          request_hash: string;
          event_type: string;
        }>
      >`
        SELECT receipt.receipt_id, receipt.event_id, receipt.request_hash, event.event_type
        FROM game.mutation_receipts receipt
        JOIN game.event_ledger event ON event.event_id = receipt.event_id
        WHERE receipt.world_id = ${input.scope.worldId}
          AND receipt.idempotency_key = ${input.idempotencyKey}
        LIMIT 1
        FOR UPDATE OF receipt
      `;
      if (existing[0]) {
        if (existing[0].request_hash !== hash) {
          throw new NonMutatingEventError(
            "idempotency_conflict",
            "Idempotency key was already used for a different action outcome.",
          );
        }
        return {
          eventId: existing[0].event_id,
          receiptId: existing[0].receipt_id,
          eventType: UniversalEventTypeSchema.parse(existing[0].event_type),
          idempotentReplay: true,
        };
      }

      const eventId = randomUUID();
      const receiptId = randomUUID();
      const eventPayload = {
        status: "committed",
        receiptId,
        requestHash: hash,
        authority: "player",
        sourcePlanId: input.sourcePlanId ?? null,
        sourceStepId: input.sourceStepId ?? null,
        operationTypes: [],
        playerVisibleFacts,
        hiddenFacts,
        eventPayload: input.payload,
      };

      await transaction`
        INSERT INTO game.event_ledger (
          event_id, world_id, shard_id, idempotency_key, world_time,
          event_type, involved_entity_ids, payload, created_at
        )
        VALUES (
          ${eventId}, ${input.scope.worldId}, ${input.scope.shardId},
          ${input.idempotencyKey}, now(), ${eventType},
          ${json([input.actorId])}::jsonb, ${json(eventPayload)}::jsonb, now()
        )
      `;

      await transaction`
        INSERT INTO game.mutation_receipts (
          receipt_id, world_id, shard_id, idempotency_key, request_hash,
          authority, actor_id, event_id, symbol_map, player_visible_facts,
          hidden_facts, request_payload, created_at
        )
        VALUES (
          ${receiptId}, ${input.scope.worldId}, ${input.scope.shardId},
          ${input.idempotencyKey}, ${hash}, 'player', ${input.actorId}, ${eventId},
          '{}'::jsonb, ${json(playerVisibleFacts)}::jsonb,
          ${json(hiddenFacts)}::jsonb,
          ${json({
            eventType,
            actorId: input.actorId,
            sourcePlanId: input.sourcePlanId ?? null,
            sourceStepId: input.sourceStepId ?? null,
            payload: input.payload,
          })}::jsonb,
          now()
        )
      `;

      return { eventId, receiptId, eventType, idempotentReplay: false };
    });
  }

  return { record };
}

export type NonMutatingEventStore = ReturnType<typeof createNonMutatingEventStore>;
