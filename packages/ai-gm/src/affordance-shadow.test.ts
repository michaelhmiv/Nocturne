import { describe, expect, it, vi } from "vitest";
import type { AffordanceAssessmentRequest } from "@nocturne/contracts";
import { NOCTURNE_GAME_CONSTITUTION } from "./game-constitution.js";
import { runAffordanceShadowAssessment } from "./affordance-shadow.js";

const request: AffordanceAssessmentRequest = {
  command: "I eat gum off a light pole.",
  actorId: "10000000-0000-4000-8000-000000000001",
  resolvedEntityIds: [],
  enabledHandlers: ["consume", "search", "interact"],
  gameMasterContext: {
    constitution: NOCTURNE_GAME_CONSTITUTION,
    currentCommand: "I eat gum off a light pole.",
    currentScene: {
      locationId: "10000000-0000-4000-8000-000000000002",
      locationName: "Foundry Row",
      locationDescription: "An ordinary urban street.",
      summary: "The player stands by the curb.",
      unresolvedThreads: [],
    },
    recentTurns: [],
    relevantMemories: [],
    playerKnownFacts: [],
    activePlan: null,
    estimatedTokens: 300,
  },
};

describe("affordance shadow runner", () => {
  it("does not call the provider when disabled", async () => {
    const generateStructured = vi.fn();
    const result = await runAffordanceShadowAssessment({
      enabled: false,
      client: { generateStructured },
      request,
    });
    expect(result).toEqual({ state: "disabled" });
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("returns a failed audit result instead of throwing", async () => {
    const result = await runAffordanceShadowAssessment({
      enabled: true,
      client: {
        generateStructured: vi.fn().mockRejectedValue(new Error("provider unavailable")),
      },
      request,
    });
    expect(result).toEqual({ state: "failed", error: "provider unavailable" });
  });

  it("records a schema-valid assessment without changing routing", async () => {
    const record = vi.fn();
    const result = await runAffordanceShadowAssessment({
      enabled: true,
      client: {
        generateStructured: vi.fn().mockResolvedValue({
          data: {
            terminalIntent: "consume",
            premises: [
              {
                text: "gum",
                concept: "old chewing gum",
                role: "object",
                status: "plausible_ephemeral",
                persistenceReason: "It is immediately consumed and low-value.",
                advantageCategories: ["none"],
                potentialConsequences: ["unpleasant taste"],
              },
            ],
            requiresSearch: false,
            requiresClarification: false,
            rationale: "Eating is the terminal intent.",
          },
          provider: "test",
          actualModel: "test",
          usage: {},
        }),
      },
      request,
      record,
    });
    expect(result.state).toBe("completed");
    expect(record).toHaveBeenCalledWith(result);
  });
});
