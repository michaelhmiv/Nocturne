import { describe, expect, it } from "vitest";
import type { SearchDiscoveryAnalysisRequest } from "@nocturne/contracts";
import { decideSearchDiscovery } from "./search-decision.js";

const actorId = "00000000-0000-4000-8000-000000000201";
const areaId = "00000000-0000-4000-8000-000000000202";
const entityId = "00000000-0000-4000-8000-000000000203";
const sourceId = "00000000-0000-4000-8000-000000000204";

const input: SearchDiscoveryAnalysisRequest = {
  rawText: "look around for a crowbar",
  actorId,
  areaId,
  areaName: "Garage",
  areaDescription: "A cluttered residential garage.",
  requestedConcept: "crowbar",
  actorFacts: ["fact-actor: condition=100"],
  areaFacts: [],
  existingCandidates: [
    {
      entityId,
      name: "Steel Crowbar",
      conceptSummary: "A steel prying tool.",
      hidden: false,
      concealment: 10,
      supportingFactIds: ["fact-crowbar"],
    },
  ],
  materializationSourceIds: [sourceId],
};

function client(sourceChoice = "existing_0") {
  return {
    decide: async () => ({
      answers: {
        target_family: { type: "choice" as const, choice: "item", confidence: 0.96 },
        source: { type: "choice" as const, choice: sourceChoice, confidence: 0.94 },
        actor_capability: { type: "score" as const, score: 6, confidence: 0.9 },
        target_difficulty: { type: "score" as const, score: 3, confidence: 0.91 },
      },
      requestedModel: "~typesafe/jev-latest",
      actualModel: "typesafe/jev-1.13",
      provider: "openrouter" as const,
      latencyMs: 190,
    }),
  };
}

describe("Jev search discovery", () => {
  it("prefers a supplied existing entity and creates bounded contest inputs", async () => {
    const result = await decideSearchDiscovery(client() as never, input);
    expect(result.fastPathEligible).toBe(true);
    expect(result.analysis?.selectedExistingEntityId).toBe(entityId);
    expect(result.analysis?.mayMaterialize).toBe(false);
    expect(result.analysis?.actorScore).toBe(6);
    expect(result.analysis?.targetScore).toBe(3);
    expect(result.analysis?.modifiers).toEqual([]);
  });

  it("can select an authorized materialization source without materializing directly", async () => {
    const result = await decideSearchDiscovery(client("materialize_0") as never, {
      ...input,
      existingCandidates: [],
    });
    expect(result.fastPathEligible).toBe(true);
    expect(result.analysis?.selectedExistingEntityId).toBeUndefined();
    expect(result.analysis?.mayMaterialize).toBe(true);
    expect(result.analysis?.selectedMaterializationSourceId).toBe(sourceId);
  });

  it("falls back when Jev is not confident enough", async () => {
    const lowConfidence = {
      decide: async () => ({
        answers: {
          target_family: { type: "choice" as const, choice: "item", confidence: 0.4 },
          source: { type: "choice" as const, choice: "existing_0", confidence: 0.94 },
          actor_capability: { type: "score" as const, score: 5, confidence: 0.9 },
          target_difficulty: { type: "score" as const, score: 5, confidence: 0.9 },
        },
        requestedModel: "~typesafe/jev-latest",
        actualModel: "typesafe/jev-1.13",
        provider: "openrouter" as const,
        latencyMs: 190,
      }),
    };
    const result = await decideSearchDiscovery(lowConfidence as never, input);
    expect(result.fastPathEligible).toBe(false);
    expect(result.fallbackReason).toBe("low_decision_confidence");
    expect(result.analysis).toBeNull();
  });
});
