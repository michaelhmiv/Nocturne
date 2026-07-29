import { randomUUID } from "node:crypto";
import {
  AuthoritativeConversationResponseSchema,
  ConversationMessageRequestSchema,
  MAX_CONVERSATION_HISTORY_ENTRIES,
  PlayerSafeConversationHistorySchema,
  PlayerSafeConversationResponseSchema,
  type AuthoritativeConversationResponse,
  type ConversationMessageRequest,
  type PlayerSafeConversationResponse,
} from "@nocturne/contracts";
import type { TransactionSql } from "postgres";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";

export type ConversationTurnStatus = "pending" | "completed" | "failed";

export type ConversationTurn = {
  turnId: string;
  conversationId: string;
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  request: ConversationMessageRequest;
  status: ConversationTurnStatus;
  authoritativeResponse: AuthoritativeConversationResponse | null;
  playerSafeResponse: PlayerSafeConversationResponse | null;
  errorCode: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

type TurnRow = {
  turn_id: string;
  conversation_id: string;
  user_id: string;
  idempotency_key: string;
  request_hash: string;
  request: unknown;
  status: ConversationTurnStatus;
  authoritative_response: unknown | null;
  player_safe_response: unknown | null;
  error_code: string | null;
  created_at: Date;
  updated_at: Date;
  completed_at: Date | null;
};

export class ConversationStoreError extends Error {
  constructor(
    readonly code:
      "invalid_input" | "idempotency_conflict" | "forbidden" | "not_found" | "invalid_transition",
    message: string,
  ) {
    super(message);
    this.name = "ConversationStoreError";
  }
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function identifier(value: string, name: string, maximum: number, uuid = false) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > maximum ||
    (uuid && !uuidPattern.test(value))
  ) {
    throw new ConversationStoreError("invalid_input", `Invalid ${name}.`);
  }
  return value;
}

function parse<T>(schema: { parse(value: unknown): T }, value: unknown, name: string): T {
  try {
    return schema.parse(value);
  } catch {
    throw new ConversationStoreError("invalid_input", `Invalid ${name}.`);
  }
}

function turn(row: TurnRow): ConversationTurn {
  return {
    turnId: row.turn_id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    request: parse(ConversationMessageRequestSchema, row.request, "stored conversation request"),
    status: row.status,
    authoritativeResponse:
      row.authoritative_response === null
        ? null
        : parse(
            AuthoritativeConversationResponseSchema,
            row.authoritative_response,
            "stored authoritative response",
          ),
    playerSafeResponse:
      row.player_safe_response === null
        ? null
        : parse(
            PlayerSafeConversationResponseSchema,
            row.player_safe_response,
            "stored player-safe response",
          ),
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export function createConversationStore(database: ReturnType<typeof createDatabase>) {
  async function requireOwner(sql: TransactionSql, userId: string, conversationId: string) {
    const rows = await sql<{ user_id: string }[]>`
      SELECT user_id FROM game.conversations WHERE conversation_id = ${conversationId}
    `;
    if (!rows[0]) throw new ConversationStoreError("not_found", "Conversation not found.");
    if (rows[0].user_id !== userId) {
      throw new ConversationStoreError("forbidden", "Conversation belongs to another user.");
    }
  }

  async function reserveTurn(
    userIdValue: string,
    conversationIdValue: string,
    idempotencyKeyValue: string,
    requestHashValue: string,
    requestValue: unknown,
  ): Promise<{ kind: "created" | "existing"; turn: ConversationTurn }> {
    const userId = identifier(userIdValue, "user ID", 256);
    const conversationId = identifier(conversationIdValue, "conversation ID", 36, true);
    const idempotencyKey = identifier(idempotencyKeyValue, "idempotency key", 256);
    const requestHash = identifier(requestHashValue, "request hash", 256);
    const request = parse(ConversationMessageRequestSchema, requestValue, "conversation request");

    return database.client.begin(async (sql) => {
      await sql`
        INSERT INTO game.conversations (conversation_id, user_id)
        VALUES (${conversationId}, ${userId})
        ON CONFLICT (conversation_id) DO NOTHING
      `;
      await requireOwner(sql, userId, conversationId);

      const inserted = await sql<TurnRow[]>`
        INSERT INTO game.conversation_turns (
          turn_id, conversation_id, user_id, idempotency_key, request_hash, request
        ) VALUES (
          ${randomUUID()}, ${conversationId}, ${userId}, ${idempotencyKey},
          ${requestHash}, ${json(request)}
        )
        ON CONFLICT (user_id, conversation_id, idempotency_key) DO NOTHING
        RETURNING *
      `;
      if (inserted[0]) return { kind: "created" as const, turn: turn(inserted[0]) };

      const existing = await sql<TurnRow[]>`
        SELECT * FROM game.conversation_turns
        WHERE user_id = ${userId}
          AND conversation_id = ${conversationId}
          AND idempotency_key = ${idempotencyKey}
      `;
      if (!existing[0]) throw new ConversationStoreError("not_found", "Turn not found.");
      if (existing[0].request_hash !== requestHash) {
        throw new ConversationStoreError(
          "idempotency_conflict",
          "Idempotency key was already used for a different request.",
        );
      }
      return { kind: "existing" as const, turn: turn(existing[0]) };
    });
  }

  async function completeTurn(
    userIdValue: string,
    turnIdValue: string,
    authoritativeResponseValue: unknown,
    playerSafeResponseValue: unknown,
  ): Promise<ConversationTurn> {
    const userId = identifier(userIdValue, "user ID", 256);
    const turnId = identifier(turnIdValue, "turn ID", 36, true);
    const authoritativeResponse = parse(
      AuthoritativeConversationResponseSchema,
      authoritativeResponseValue,
      "authoritative response",
    );
    const playerSafeResponse = parse(
      PlayerSafeConversationResponseSchema,
      playerSafeResponseValue,
      "player-safe response",
    );

    return database.client.begin(async (sql) => {
      const updated = await sql<TurnRow[]>`
        UPDATE game.conversation_turns
        SET status = 'completed', authoritative_response = ${json(authoritativeResponse)},
            player_safe_response = ${json(playerSafeResponse)}, error_code = NULL,
            updated_at = now(), completed_at = now()
        WHERE turn_id = ${turnId} AND user_id = ${userId} AND status = 'pending'
        RETURNING *
      `;
      if (updated[0]) return turn(updated[0]);

      const existing = await sql<TurnRow[]>`
        SELECT * FROM game.conversation_turns
        WHERE turn_id = ${turnId} AND user_id = ${userId}
      `;
      if (!existing[0]) throw new ConversationStoreError("not_found", "Turn not found.");
      if (existing[0].status === "completed") return turn(existing[0]);
      throw new ConversationStoreError("invalid_transition", "Failed turns cannot be completed.");
    });
  }

  async function failTurn(
    userIdValue: string,
    turnIdValue: string,
    errorCodeValue: string,
  ): Promise<ConversationTurn> {
    const userId = identifier(userIdValue, "user ID", 256);
    const turnId = identifier(turnIdValue, "turn ID", 36, true);
    const errorCode = identifier(errorCodeValue, "error code", 128);

    return database.client.begin(async (sql) => {
      const updated = await sql<TurnRow[]>`
        UPDATE game.conversation_turns
        SET status = 'failed', error_code = ${errorCode}, updated_at = now(), completed_at = now()
        WHERE turn_id = ${turnId} AND user_id = ${userId} AND status = 'pending'
        RETURNING *
      `;
      if (updated[0]) return turn(updated[0]);

      const existing = await sql<TurnRow[]>`
        SELECT * FROM game.conversation_turns
        WHERE turn_id = ${turnId} AND user_id = ${userId}
      `;
      if (!existing[0]) throw new ConversationStoreError("not_found", "Turn not found.");
      if (existing[0].status === "failed") return turn(existing[0]);
      throw new ConversationStoreError("invalid_transition", "Completed turns cannot be failed.");
    });
  }

  async function listPlayerSafeHistory(userIdValue: string, conversationIdValue: string) {
    const userId = identifier(userIdValue, "user ID", 256);
    const conversationId = identifier(conversationIdValue, "conversation ID", 36, true);

    return database.client.begin(async (sql) => {
      await requireOwner(sql, userId, conversationId);
      const rows = await sql<{ request: unknown; response: unknown }[]>`
        SELECT request, player_safe_response AS response
        FROM (
          SELECT request, player_safe_response, created_at, turn_id
          FROM game.conversation_turns
          WHERE user_id = ${userId}
            AND conversation_id = ${conversationId}
            AND status = 'completed'
          ORDER BY created_at DESC, turn_id DESC
          LIMIT ${MAX_CONVERSATION_HISTORY_ENTRIES}
        ) recent
        ORDER BY created_at ASC, turn_id ASC
      `;
      return parse(PlayerSafeConversationHistorySchema, rows, "stored player-safe history");
    });
  }

  return { reserveTurn, completeTurn, failTurn, listPlayerSafeHistory };
}

export type ConversationStore = ReturnType<typeof createConversationStore>;
