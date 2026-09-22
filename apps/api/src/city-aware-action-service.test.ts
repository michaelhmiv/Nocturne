import { describe, expect, it, vi } from "vitest";
import { createCityAwareWorldActionService } from "./city-aware-action-service.js";

const SCOPE = {
  worldId: "11111111-1111-4111-8111-111111111111",
  shardId: "22222222-2222-4222-8222-222222222222",
  userId: "33333333-3333-4333-8333-333333333333",
  role: "player" as const,
  selectedCharacterId: "44444444-4444-4444-8444-444444444444",
};

const ACTOR = "44444444-4444-4444-8444-444444444444";
const DEST = "55555555-5555-4555-8555-555555555555";
const PLAN = "66666666-6666-4666-8666-666666666666";

function deps(overrides: Record<string, unknown> = {}) {
  return {
    decisionClient: { decide: vi.fn() },
    requests: {
      reserve: vi.fn(async () => ({
        requestId: "77777777-7777-4777-8777-777777777777",
        status: "reserved",
        requestHash: "h",
        planId: null,
        playerSafeResult: null,
        created: true,
      })),
      readForResume: vi.fn(),
      transition: vi.fn(async ({ status }: { status: string }) => status),
      stage: vi.fn(),
    },
    context: {
      compile: vi.fn(async () => ({
        compilationId: "88888888-8888-4888-8888-888888888888",
        commandExcerpt: "go",
        entities: [],
        playerKnownFacts: [],
        authoritativeHiddenFacts: [],
      })),
    },
    references: {
      clarification: vi.fn(() => null),
      explicitEntityIds: vi.fn(() => []),
      recordInterpretation: vi.fn(),
      buildCandidates: vi.fn(),
    },
    plans: {
      findActive: vi.fn(async () => null),
      create: vi.fn(async () => ({ planId: PLAN, status: "ready", steps: [], activeStepId: null })),
      read: vi.fn(async () => ({
        planId: PLAN,
        actorId: ACTOR,
        status: "completed",
        planVersion: 1,
        activeStepId: null,
        exclusivePhysical: true,
        steps: [],
        createdAt: "2026-09-22T13:00:00.000Z",
        updatedAt: "2026-09-22T13:00:00.000Z",
      })),
      startReadyStep: vi.fn(async () => null),
      completeStep: vi.fn(),
      transitionPlan: vi.fn(),
    },
    steps: {
      readExecutable: vi.fn(),
      markWaiting: vi.fn(),
      failStep: vi.fn(),
    },
    handlers: {},
    compileNarrativeContext: vi.fn(async () => ({ recentTurns: [], relevantMemories: [] })),
    ...overrides,
  };
}

describe("city-aware submit", () => {
  it("builds a move plan to the resolved OSM destination", async () => {
    const bag = deps({
      resolveCityDestination: vi.fn(async () => ({
        entityId: DEST,
        sourceKey: "osm:node:14th-convenience",
        name: "East 14th Convenience",
      })),
    });
    const service = createCityAwareWorldActionService(bag as never);
    const result = await service.submit({
      scope: SCOPE,
      actorId: ACTOR,
      command: "go to the nearest grocery store",
      idempotencyKey: "grocery-1",
    });
    expect(bag.plans.create).toHaveBeenCalled();
    const created = bag.plans.create.mock.calls.at(0)?.at(0) as
      { proposal?: { steps?: Array<{ intentPayload?: { destinationId?: string } }> } } | undefined;
    expect(created?.proposal?.steps?.[0]?.intentPayload?.destinationId).toBe(DEST);
    expect(result.state).toBe("completed");
  });

  it("does not invent a store when the city source is empty", async () => {
    const bag = deps({
      resolveCityDestination: vi.fn(async () => null),
    });
    const service = createCityAwareWorldActionService(bag as never);
    const result = await service.submit({
      scope: SCOPE,
      actorId: ACTOR,
      command: "go to the nearest grocery store",
      idempotencyKey: "grocery-missing",
    });
    expect(result.state).toBe("waiting_for_clarification");
    expect(bag.plans.create).not.toHaveBeenCalled();
  });

  it("answers what is around me from the city scene packet without Jev", async () => {
    const bag = deps({
      compileLiveScene: vi.fn(async () => ({
        hereName: "14th Street Convenience",
        facts: [
          "You are at 14th Street Convenience (food).",
          "Nearby: Third Avenue Fuel (fuel, 80m).",
        ],
      })),
    });
    const service = createCityAwareWorldActionService(bag as never);
    const result = await service.submit({
      scope: SCOPE,
      actorId: ACTOR,
      command: "what is around me",
      idempotencyKey: "look-1",
    });
    expect(bag.decisionClient.decide).not.toHaveBeenCalled();
    expect(result.state).toBe("completed");
    if (result.state === "completed") {
      expect(result.narration).toMatch(/14th Street Convenience/);
      expect(result.narration).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/i);
    }
  });
});
