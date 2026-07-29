import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { MAX_CONVERSATION_HISTORY_ENTRIES } from "@nocturne/contracts";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ConversationStoreError, createConversationStore, createDatabase } from "../src/index.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

const viewpointPlan = {
  intent: { kind: "question" as const, summary: "Answer the question." },
  facts: [],
  checks: [],
};
const authoritativeResponse = {
  responseId: "response-1",
  narration: "The authoritative answer.",
  plan: {
    viewpointPlan,
    hiddenFacts: [
      {
        factId: "hidden-1",
        claim: "classified.detail",
        value: "authoritative-only",
        validity: { state: "valid" as const, validFromTurn: 0 },
        provenance: { kind: "gm_inference" as const, sourceId: "source-1" },
        viewpointId: "viewpoint-1",
        visibility: "authoritative_hidden" as const,
      },
    ],
    checkAuthorizations: [],
    hiddenChecks: [],
    unconditionalOperations: [],
  },
  execution: { state: "completed" as const },
  outcomes: [],
  hiddenOutcomes: [],
};
const playerSafeResponse = {
  responseId: "response-1",
  narration: "The answer.",
  plan: viewpointPlan,
  execution: { state: "completed" as const },
  outcomes: [],
};

describePostgres("conversation store (PostgreSQL)", () => {
  const database = createDatabase(databaseUrl!);
  const store = createConversationStore(database);

  beforeAll(async () => {
    await execFileAsync("pnpm", ["exec", "tsx", "src/migrate.ts"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
  });

  afterAll(() => database.close());
  beforeEach(async () => {
    await database.client`TRUNCATE game.conversations CASCADE`;
  });

  it("reserves an initial pending turn and replays the same payload", async () => {
    const conversationId = randomUUID();
    const request = { message: "Who is there?" };

    const created = await store.reserveTurn("alice", conversationId, "key-1", "hash-1", request);
    const replay = await store.reserveTurn("alice", conversationId, "key-1", "hash-1", request);

    expect(created.kind).toBe("created");
    expect(created.turn).toMatchObject({
      conversationId,
      userId: "alice",
      idempotencyKey: "key-1",
      requestHash: "hash-1",
      request,
      status: "pending",
    });
    expect(replay).toEqual({ kind: "existing", turn: created.turn });
  });

  it("rejects an idempotency replay with a changed payload hash", async () => {
    const conversationId = randomUUID();
    await store.reserveTurn("alice", conversationId, "key-1", "hash-1", {
      message: "First",
    });

    await expect(
      store.reserveTurn("alice", conversationId, "key-1", "hash-2", { message: "Changed" }),
    ).rejects.toMatchObject<Partial<ConversationStoreError>>({ code: "idempotency_conflict" });
  });

  it("rejects cross-user ownership of a conversation", async () => {
    const conversationId = randomUUID();
    await store.reserveTurn("alice", conversationId, "alice-key", "hash-1", {
      message: "First",
    });

    await expect(
      store.reserveTurn("bob", conversationId, "bob-key", "hash-2", { message: "Intrude" }),
    ).rejects.toMatchObject<Partial<ConversationStoreError>>({ code: "forbidden" });
  });

  it("completes pending turns and safely replays completion", async () => {
    const reserved = await store.reserveTurn("alice", randomUUID(), "key-1", "hash-1", {
      message: "Complete me",
    });

    const completed = await store.completeTurn(
      "alice",
      reserved.turn.turnId,
      authoritativeResponse,
      playerSafeResponse,
    );
    const replay = await store.completeTurn(
      "alice",
      reserved.turn.turnId,
      { ...authoritativeResponse, narration: "Must not replace the original." },
      { ...playerSafeResponse, narration: "Must not replace the original." },
    );

    expect(completed.status).toBe("completed");
    expect(replay).toEqual(completed);
  });

  it("retains failed turns and rejects invalid terminal transitions", async () => {
    const failedReservation = await store.reserveTurn(
      "alice",
      randomUUID(),
      "failed-key",
      "hash-1",
      { message: "Fail me" },
    );
    const failed = await store.failTurn("alice", failedReservation.turn.turnId, "provider_error");

    expect(await store.failTurn("alice", failed.turnId, "different_error")).toEqual(failed);
    await expect(
      store.completeTurn("alice", failed.turnId, authoritativeResponse, playerSafeResponse),
    ).rejects.toMatchObject<Partial<ConversationStoreError>>({ code: "invalid_transition" });

    const completedReservation = await store.reserveTurn(
      "alice",
      randomUUID(),
      "completed-key",
      "hash-2",
      { message: "Complete me" },
    );
    await store.completeTurn(
      "alice",
      completedReservation.turn.turnId,
      authoritativeResponse,
      playerSafeResponse,
    );
    await expect(
      store.failTurn("alice", completedReservation.turn.turnId, "late_error"),
    ).rejects.toMatchObject<Partial<ConversationStoreError>>({ code: "invalid_transition" });
  });

  it("scopes terminal mutations to the owning user", async () => {
    const reserved = await store.reserveTurn("alice", randomUUID(), "key-1", "hash-1", {
      message: "Keep this private",
    });

    await expect(
      store.completeTurn("bob", reserved.turn.turnId, authoritativeResponse, playerSafeResponse),
    ).rejects.toMatchObject<Partial<ConversationStoreError>>({ code: "not_found" });
    await expect(store.failTurn("bob", reserved.turn.turnId, "intrusion")).rejects.toMatchObject<
      Partial<ConversationStoreError>
    >({ code: "not_found" });

    const replay = await store.reserveTurn(
      "alice",
      reserved.turn.conversationId,
      "key-1",
      "hash-1",
      reserved.turn.request,
    );
    expect(replay.turn.status).toBe("pending");
  });

  it("enforces terminal shape and conversation ownership in PostgreSQL", async () => {
    const conversationId = randomUUID();
    const reserved = await store.reserveTurn("alice", conversationId, "key-1", "hash-1", {
      message: "Guard invariants",
    });

    await expect(
      database.client`
        UPDATE game.conversation_turns
        SET status = 'failed', completed_at = now(), error_code = NULL
        WHERE turn_id = ${reserved.turn.turnId}
      `,
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      database.client`
        INSERT INTO game.conversation_turns
          (conversation_id, user_id, idempotency_key, request_hash, request)
        VALUES
          (${conversationId}, 'bob', 'foreign-key', 'foreign-hash', '{"message":"Intrude"}'::jsonb)
      `,
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("fails closed when replayed response JSON is malformed", async () => {
    const conversationId = randomUUID();
    const request = { message: "Validate stored output" };
    const reserved = await store.reserveTurn("alice", conversationId, "key-1", "hash-1", request);

    await database.client`
      UPDATE game.conversation_turns
      SET status = 'completed',
          authoritative_response = ${JSON.stringify(authoritativeResponse)}::jsonb,
          player_safe_response = '{"responseId":"broken"}'::jsonb,
          completed_at = now()
      WHERE turn_id = ${reserved.turn.turnId}
    `;

    await expect(
      store.reserveTurn("alice", conversationId, "key-1", "hash-1", request),
    ).rejects.toMatchObject<Partial<ConversationStoreError>>({ code: "invalid_input" });
  });

  it("reopens failed and abandoned pending turns with a single lease claimant", async () => {
    const failed = await store.reserveTurn("alice", randomUUID(), "failed-key", "hash-1", {
      message: "Retry me",
    });
    await store.failTurn("alice", failed.turn.turnId, "provider_failure");
    await expect(
      store.reopenTurn("alice", failed.turn.turnId, new Date(Date.now() - 60_000)),
    ).resolves.toMatchObject({ status: "pending", errorCode: null });
    await expect(
      store.reopenTurn("alice", failed.turn.turnId, new Date(Date.now() - 60_000)),
    ).rejects.toMatchObject<Partial<ConversationStoreError>>({ code: "invalid_transition" });

    const abandoned = await store.reserveTurn("alice", randomUUID(), "pending-key", "hash-2", {
      message: "Resume me",
    });
    await database.client`
      UPDATE game.conversation_turns
      SET updated_at = now() - interval '10 minutes'
      WHERE turn_id = ${abandoned.turn.turnId}
    `;
    const claims = await Promise.allSettled([
      store.reopenTurn("alice", abandoned.turn.turnId, new Date(Date.now() - 60_000)),
      store.reopenTurn("alice", abandoned.turn.turnId, new Date(Date.now() - 60_000)),
    ]);
    const winner = claims.find(
      (claim): claim is PromiseFulfilledResult<Awaited<ReturnType<typeof store.reopenTurn>>> =>
        claim.status === "fulfilled",
    )!.value;
    expect(claims.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(claims.filter(({ status }) => status === "rejected")).toHaveLength(1);
    await expect(
      store.failTurn("alice", abandoned.turn.turnId, "late-worker", abandoned.turn.updatedAt),
    ).rejects.toMatchObject<Partial<ConversationStoreError>>({ code: "invalid_transition" });
    await expect(
      store.failTurn("alice", abandoned.turn.turnId, "winner", winner.updatedAt),
    ).resolves.toMatchObject({ status: "failed" });
  });

  it("returns bounded ordered player-safe history without authoritative fields", async () => {
    const conversationId = randomUUID();
    for (let index = 0; index <= MAX_CONVERSATION_HISTORY_ENTRIES; index += 1) {
      const request = { message: `Message ${index.toString().padStart(3, "0")}` };
      const reserved = await store.reserveTurn(
        "alice",
        conversationId,
        `key-${index}`,
        `hash-${index}`,
        request,
      );
      await store.completeTurn("alice", reserved.turn.turnId, authoritativeResponse, {
        ...playerSafeResponse,
        responseId: `response-${index}`,
      });
    }

    const history = await store.listPlayerSafeHistory("alice", conversationId);
    const serialized = JSON.stringify(history);

    expect(history).toHaveLength(MAX_CONVERSATION_HISTORY_ENTRIES);
    expect(history[0]?.request.message).toBe("Message 001");
    expect(history.at(-1)?.request.message).toBe("Message 100");
    expect(serialized).not.toContain("authoritative-only");
    expect(serialized).not.toContain("hiddenFacts");
    await expect(store.listPlayerSafeHistory("bob", conversationId)).rejects.toMatchObject<
      Partial<ConversationStoreError>
    >({ code: "forbidden" });
  }, 15_000);
});
