import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createScheduledRequestFinalizer } from "./scheduled-request-finalizer.js";

const scope = {
  worldId: randomUUID(),
  shardId: randomUUID(),
};
const actorId = randomUUID();
const planId = randomUUID();
const stepId = randomUUID();
const eventId = randomUUID();
const requestId = randomUUID();
const now = new Date("2026-09-21T18:00:00Z").toISOString();

const completedPlan = {
  planId,
  actorId,
  status: "completed" as const,
  planVersion: 2,
  activeStepId: null,
  exclusivePhysical: true,
  steps: [
    {
      stepId,
      order: 1,
      kind: "interact",
      description: "Stretch",
      status: "completed" as const,
      idempotencyKey: "stretch:step:1",
      waitingReason: null,
      outcomeGrade: "complete_success",
    },
  ],
  createdAt: now,
  updatedAt: now,
};

function fixture() {
  let requestStatus = "waiting";
  let playerSafeResult: Record<string, unknown> | null = null;
  let eventIds = [eventId];
  let eventFacts: string[] | null = ["You complete the timed stretch."];
  let requestExists = true;
  const read = vi.fn().mockResolvedValue(completedPlan);
  const transition = vi.fn(async (input: { playerSafeResult: Record<string, unknown> }) => {
    requestStatus = "completed";
    playerSafeResult = input.playerSafeResult;
  });
  const client = vi.fn(async (parts: TemplateStringsArray) => {
    const query = parts.join("");
    if (query.includes("FROM game.world_action_requests")) {
      return requestExists
        ? [{
            request_id: requestId,
            status: requestStatus,
            player_safe_result: playerSafeResult,
          }]
        : [];
    }
    if (query.includes("FROM game.action_plan_steps")) {
      return eventIds.map((id) => ({ result_event_id: id }));
    }
    if (query.includes("FROM game.event_ledger")) {
      return eventFacts ? [{ payload: { playerVisibleFacts: eventFacts } }] : [];
    }
    throw new Error("Unexpected SQL in scheduled finalization fixture.");
  });
  const finalize = createScheduledRequestFinalizer({
    database: { client } as never,
    plans: { read } as never,
    requests: { transition } as never,
  });
  const input = { scope, planId, stepId, actorId, eventId };
  return {
    finalize,
    input,
    client,
    read,
    transition,
    setEventIds: (ids: string[]) => { eventIds = ids; },
    setFacts: (facts: string[] | null) => { eventFacts = facts; },
    setStatus: (status: string) => { requestStatus = status; },
    setRequestExists: (exists: boolean) => { requestExists = exists; },
  };
}

describe("scheduled player request finalization", () => {
  it("terminalizes exactly once with scoped, committed event facts", async () => {
    const setup = fixture();
    const first = await setup.finalize(setup.input);
    const second = await setup.finalize(setup.input);
    expect(first).toEqual({ terminalized: true, idempotentReplay: false });
    expect(second).toEqual({ terminalized: true, idempotentReplay: true });
    expect(setup.transition).toHaveBeenCalledOnce();
    expect(setup.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        scope,
        requestId,
        expectedStatus: "waiting",
        status: "completed",
        authoritativeResult: { eventIds: [eventId] },
        playerSafeResult: expect.objectContaining({
          state: "completed",
          requestId,
          narration: "You complete the timed stretch.",
          eventIds: [eventId],
        }),
      }),
    );
  });

  it("leaves an unfinished multi-step plan waiting", async () => {
    const setup = fixture();
    setup.read.mockResolvedValue({ ...completedPlan, status: "running" });
    expect(await setup.finalize(setup.input)).toEqual({ terminalized: false });
    expect(setup.client).not.toHaveBeenCalled();
    expect(setup.transition).not.toHaveBeenCalled();
  });

  it("does not fabricate a player request for unowned system work", async () => {
    const setup = fixture();
    setup.setRequestExists(false);
    expect(await setup.finalize(setup.input)).toEqual({ terminalized: false });
    expect(setup.transition).not.toHaveBeenCalled();
  });

  it("rejects unlinked or missing committed events", async () => {
    const setup = fixture();
    setup.setEventIds([randomUUID()]);
    await expect(setup.finalize(setup.input)).rejects.toThrow(/not linked/i);
    setup.setEventIds([eventId]);
    setup.setFacts(null);
    await expect(setup.finalize(setup.input)).rejects.toThrow(/missing/i);
    expect(setup.transition).not.toHaveBeenCalled();
  });

  it("never changes a cancelled player request into success", async () => {
    const setup = fixture();
    setup.setStatus("cancelled");
    await expect(setup.finalize(setup.input)).rejects.toThrow(/Only a waiting/i);
    expect(setup.transition).not.toHaveBeenCalled();
  });
});
