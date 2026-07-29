import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resolveProbabilityCheck } from "@nocturne/rules-engine";
import { createConversationService } from "../src/conversation-service.js";

const viewpointPlan = {
  intent: { kind: "question" as const, summary: "Answer the question." },
  facts: [],
  checks: [],
};
const authoritativePlan = {
  viewpointPlan,
  hiddenFacts: [],
  checkAuthorizations: [],
  hiddenChecks: [],
  unconditionalOperations: [],
};

function queuedClient(outputs: unknown[]) {
  return {
    calls: 0,
    async generateStructured<T>() {
      this.calls += 1;
      const data = outputs.shift();
      if (data instanceof Error) throw data;
      return {
        data: data as T,
        requestedModel: "test/model",
        actualModel: "test/model",
      };
    },
  };
}

function memoryTurns(nextTurnId = randomUUID()) {
  const turns = new Map<string, any>();
  return {
    turns,
    historyCalls: [] as { userId: string; conversationId: string }[],
    history: [] as { request: unknown; response: unknown }[],
    async reserveTurn(
      userId: string,
      conversationId: string,
      idempotencyKey: string,
      requestHash: string,
      request: unknown,
    ) {
      const existing = turns.get(idempotencyKey);
      if (existing) return { kind: "existing" as const, turn: existing };
      const turn = {
        turnId: nextTurnId,
        userId,
        conversationId,
        idempotencyKey,
        requestHash,
        request,
        status: "pending" as const,
        updatedAt: new Date(),
        authoritativeResponse: null,
        playerSafeResponse: null,
      };
      turns.set(idempotencyKey, turn);
      return { kind: "created" as const, turn };
    },
    async completeTurn(
      userId: string,
      turnId: string,
      authoritativeResponse: unknown,
      playerSafeResponse: unknown,
    ) {
      const turn = [...turns.values()].find(
        (candidate) => candidate.turnId === turnId && candidate.userId === userId,
      );
      Object.assign(turn, { status: "completed", authoritativeResponse, playerSafeResponse });
      return turn;
    },
    async failTurn(userId: string, turnId: string, errorCode: string) {
      const turn = [...turns.values()].find(
        (candidate) => candidate.turnId === turnId && candidate.userId === userId,
      );
      Object.assign(turn, { status: "failed", errorCode });
      return turn;
    },
    async reopenTurn(userId: string, turnId: string) {
      const turn = [...turns.values()].find(
        (candidate) => candidate.turnId === turnId && candidate.userId === userId,
      );
      if (!turn || turn.status === "completed") throw new Error("invalid transition");
      Object.assign(turn, { status: "pending", errorCode: null, updatedAt: new Date() });
      return turn;
    },
    async listPlayerSafeHistory(userId: string, conversationId: string) {
      this.historyCalls.push({ userId, conversationId });
      return this.history;
    },
  };
}

describe("conversation service", () => {
  it("reclaims a transient failed turn without poisoning its idempotency key", async () => {
    const client = queuedClient([
      new Error("temporary provider failure"),
      viewpointPlan,
      authoritativePlan,
      { narration: "Recovered." },
    ]);
    const service = createConversationService({
      client,
      turns: memoryTurns(),
      loadContext: async () => ({ playerKnownFacts: [], hiddenFacts: [] }),
    });
    const input = {
      userId: "alice",
      conversationId: randomUUID(),
      idempotencyKey: "retry-key",
      request: { message: "Try again." },
    };

    await expect(service.submitMessage(input)).rejects.toThrow("temporary provider failure");
    await expect(service.submitMessage(input)).resolves.toMatchObject({ narration: "Recovered." });
  });

  it("loads persisted player-safe history for the requested conversation", async () => {
    const client = queuedClient([
      viewpointPlan,
      authoritativePlan,
      { narration: "The corridor is currently quiet." },
    ]);
    const turns = memoryTurns();
    const conversationId = randomUUID();
    const service = createConversationService({
      client,
      turns,
      loadContext: async () => ({ playerKnownFacts: [], hiddenFacts: [] }),
    });

    await service.submitMessage({
      userId: "alice",
      conversationId,
      idempotencyKey: "message-history",
      request: { message: "Is the corridor quiet?" },
    });

    expect(turns.historyCalls).toEqual([{ userId: "alice", conversationId }]);
  });

  it("completes a passive conversational turn through both adjudication passes", async () => {
    const client = queuedClient([
      viewpointPlan,
      authoritativePlan,
      { narration: "The corridor is currently quiet." },
    ]);
    const turns = memoryTurns();
    const service = createConversationService({
      client,
      turns,
      loadContext: async () => ({ playerKnownFacts: [], hiddenFacts: [] }),
    });

    const response = await service.submitMessage({
      userId: "alice",
      conversationId: randomUUID(),
      idempotencyKey: "message-1",
      request: { message: "Is the corridor quiet?" },
    });

    expect(response).toMatchObject({
      narration: "The corridor is currently quiet.",
      plan: viewpointPlan,
      execution: { state: "completed" },
      outcomes: [],
    });
    expect(client.calls).toBe(3);
    expect([...turns.turns.values()][0]).toMatchObject({
      status: "completed",
      authoritativeResponse: { plan: authoritativePlan, hiddenOutcomes: [] },
      playerSafeResponse: response,
    });
  });

  it("rolls an authorized world-action check and returns the exact result", async () => {
    const turnId = randomUUID();
    const rollSecret = "test-only-roll-secret";
    const actionViewpoint = {
      intent: { kind: "world_action" as const, summary: "Open the stuck door." },
      facts: [],
      checks: [
        {
          order: 1,
          label: "Force the door",
          apparentProbability: {
            scale: "nocturne-probability-v1" as const,
            band: "even" as const,
            basisPoints: 5_000,
          },
          publicFactors: [],
          stakes: { success: "The door opens.", failure: "The door remains shut." },
        },
      ],
    };
    const actionPlan = {
      viewpointPlan: actionViewpoint,
      hiddenFacts: [],
      checkAuthorizations: [
        {
          order: 1,
          hiddenFactors: [],
          authoritativeProbability: actionViewpoint.checks[0]!.apparentProbability,
          outcomeBranches: [],
        },
      ],
      hiddenChecks: [],
      unconditionalOperations: [],
    };
    const client = queuedClient([
      actionViewpoint,
      actionPlan,
      { narration: "The attempt resolves." },
    ]);
    const service = createConversationService({
      client,
      turns: memoryTurns(turnId),
      rollSecret,
      loadContext: async () => ({ playerKnownFacts: [], hiddenFacts: [] }),
    });
    const rolled = resolveProbabilityCheck({
      serverSecret: rollSecret,
      eventId: turnId,
      checkOrder: 1,
      checkKind: "primary_action",
      authoritativeProbability: actionViewpoint.checks[0]!.apparentProbability,
    });

    const response = await service.submitMessage({
      userId: "alice",
      conversationId: randomUUID(),
      idempotencyKey: "message-1",
      request: { message: "I force the stuck door." },
    });

    expect(response.outcomes).toEqual([
      {
        order: 1,
        finalProbability: actionViewpoint.checks[0]!.apparentProbability,
        grade: rolled.outcomeGrade,
        rollBasisPoints: rolled.rollBasisPoints,
        summary: rolled.success ? "The door opens." : "The door remains shut.",
      },
    ]);
  });

  it("stops ordered checks after failure and runs hidden checks for only the executed prefix", async () => {
    const turnId = "00000000-0000-4000-8000-000000000001";
    const probability = {
      scale: "nocturne-probability-v1" as const,
      band: "even" as const,
      basisPoints: 5_000,
    };
    const checks = [1, 2].map((order) => ({
      order,
      label: `Check ${order}`,
      apparentProbability: probability,
      publicFactors: [],
      stakes: { success: `Check ${order} succeeds.`, failure: `Check ${order} fails.` },
    }));
    const orderedViewpoint = {
      intent: { kind: "world_action" as const, summary: "Attempt two dependent checks." },
      facts: [],
      checks,
    };
    const orderedPlan = {
      viewpointPlan: orderedViewpoint,
      hiddenFacts: [
        {
          factId: "hidden:dependency",
          claim: "A hidden reaction is possible.",
          value: true,
          provenance: { kind: "world_state" as const, sourceId: "hidden:event" },
          validity: { state: "valid" as const, validFromTurn: 1 },
          viewpointId: "character:one",
          visibility: "authoritative_hidden" as const,
        },
      ],
      checkAuthorizations: checks.map(({ order }) => ({
        order,
        hiddenFactors: [],
        authoritativeProbability: probability,
        outcomeBranches: [],
      })),
      hiddenChecks: [1, 2].map((order) => ({
        order,
        triggerAfterOrder: order,
        label: `Hidden ${order}`,
        probability,
        hiddenFactors: [
          {
            summary: "Hidden dependency.",
            probabilityDeltaBasisPoints: 0,
            citations: ["hidden:dependency"],
          },
        ],
        stakes: { success: "Hidden success.", failure: "Hidden failure." },
        outcomeBranches: [],
      })),
      unconditionalOperations: [],
    };
    const turns = memoryTurns(turnId);
    const service = createConversationService({
      client: queuedClient([
        orderedViewpoint,
        orderedPlan,
        { narration: "The first check fails, stopping the attempt." },
      ]),
      turns,
      rollSecret: "s0",
      loadContext: async () => ({ playerKnownFacts: [], hiddenFacts: orderedPlan.hiddenFacts }),
    });

    const response = await service.submitMessage({
      userId: "alice",
      conversationId: randomUUID(),
      idempotencyKey: "ordered-stop",
      request: { message: "Attempt both steps." },
    });

    expect(response.execution).toEqual({ state: "stopped", stoppedAfterOrder: 1 });
    expect(response.outcomes).toHaveLength(1);
    expect([...turns.turns.values()][0].authoritativeResponse.hiddenOutcomes).toHaveLength(1);
  });

  it("completes resolved mechanics with a factual player-safe fallback when narration fails", async () => {
    const turnId = "00000000-0000-4000-8000-000000000001";
    const probability = {
      scale: "nocturne-probability-v1" as const,
      band: "even" as const,
      basisPoints: 5_000,
    };
    const resolvedViewpoint = {
      intent: { kind: "world_action" as const, summary: "Cross the gap." },
      facts: [],
      checks: [
        {
          order: 1,
          label: "Cross the gap",
          apparentProbability: probability,
          publicFactors: [],
          stakes: { success: "You cross the gap.", failure: "You fail to cross the gap." },
        },
      ],
    };
    const resolvedPlan = {
      viewpointPlan: resolvedViewpoint,
      hiddenFacts: [
        {
          factId: "hidden:gap",
          claim: "SECRET_GAP_DETAIL",
          value: true,
          provenance: { kind: "world_state" as const, sourceId: "hidden:event" },
          validity: { state: "valid" as const, validFromTurn: 1 },
          viewpointId: "character:one",
          visibility: "authoritative_hidden" as const,
        },
      ],
      checkAuthorizations: [
        {
          order: 1,
          hiddenFactors: [],
          authoritativeProbability: probability,
          outcomeBranches: [],
        },
      ],
      hiddenChecks: [],
      unconditionalOperations: [],
    };
    const turns = memoryTurns(turnId);
    const service = createConversationService({
      client: queuedClient([resolvedViewpoint, resolvedPlan, new Error("narration unavailable")]),
      turns,
      rollSecret: "s0",
      loadContext: async () => ({ playerKnownFacts: [], hiddenFacts: resolvedPlan.hiddenFacts }),
    });

    const response = await service.submitMessage({
      userId: "alice",
      conversationId: randomUUID(),
      idempotencyKey: "narration-fallback",
      request: { message: "I cross the gap." },
    });

    expect(response.narration).toBe(
      "Check 1: probability 5000 basis points; roll 7910; You fail to cross the gap.",
    );
    expect(JSON.stringify(response)).not.toContain("SECRET_GAP_DETAIL");
    expect([...turns.turns.values()][0]).toMatchObject({
      status: "completed",
      playerSafeResponse: response,
    });
  });

  it("commits an authorized unconditional state operation through the database executor", async () => {
    const turnId = randomUUID();
    const viewpointId = randomUUID();
    const locationId = randomUUID();
    const fact = {
      factId: "fact:location",
      claim: "current_location",
      value: locationId,
      provenance: { kind: "world_state" as const, sourceId: locationId },
      validity: { state: "valid" as const, validFromTurn: 1 },
      viewpointId,
      visibility: "player_known" as const,
    };
    const operation = {
      type: "move_entity" as const,
      entityId: viewpointId,
      locationId,
      preconditionFactIds: [fact.factId],
    };
    const viewpoint = {
      intent: { kind: "world_action" as const, summary: "Move to the next location." },
      facts: [fact],
      checks: [],
    };
    const plan = {
      viewpointPlan: viewpoint,
      hiddenFacts: [],
      checkAuthorizations: [],
      hiddenChecks: [],
      unconditionalOperations: [operation],
    };
    const applied: unknown[] = [];
    const service = createConversationService({
      client: queuedClient([viewpoint, plan, new Error("narration unavailable")]),
      turns: memoryTurns(turnId),
      loadContext: async () => ({ viewpointId, playerKnownFacts: [fact], hiddenFacts: [] }),
      applyStateOperations: async (input) => {
        applied.push(input);
      },
    });

    const response = await service.submitMessage({
      userId: "alice",
      conversationId: randomUUID(),
      idempotencyKey: "move",
      request: { message: "I move there." },
    });

    expect(response.narration).toBe("The requested change was committed.");
    expect(applied).toEqual([
      {
        userId: "alice",
        viewpointId,
        turnId,
        eventId: turnId,
        leaseUpdatedAt: expect.any(Date),
        declaredFactIds: [fact.factId],
        operations: [operation],
      },
    ]);
  });
});
