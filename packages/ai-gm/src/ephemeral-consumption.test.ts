import { describe, expect, it, vi } from "vitest";
import type { ConsumptionAnalysisRequest } from "@nocturne/contracts";
import {
  analyzeEphemeralConsumptionResilient,
  buildEphemeralConsumptionPrompt,
  deterministicEphemeralNarration,
} from "./ephemeral-consumption.js";

const sourceId = "10000000-0000-4000-8000-000000000010";
const request: ConsumptionAnalysisRequest = {
  actorId: "10000000-0000-4000-8000-000000000001",
  rawText: "I eat gum off a light pole.",
  locationName: "Foundry Row",
  locationDescription: "An ordinary urban street.",
  actorState: { resources: { energy: 10 } },
  candidates: [
    {
      sourceType: "ephemeral_environment",
      sourceId,
      name: "old chewing gum",
      description: "One small weathered piece stuck to a municipal light pole.",
      access: "ambient",
      quantity: 1,
      state: { ephemeral: true, persistenceRequired: false },
      constraints: [
        "exists only for this immediate action",
        "must not enter inventory",
        "must not grant meaningful resources or advantages",
      ],
    },
  ],
};

describe("ephemeral consumption analysis", () => {
  it("explains the nonpersistent authority boundary to the model", () => {
    const prompt = buildEphemeralConsumptionPrompt(request);
    expect(prompt).toContain("does not create an item");
    expect(prompt).toContain("zero nutrition");
    expect(prompt).toContain("Do not materialize");
    expect(prompt).toContain(sourceId);
  });

  it("falls back to zero-benefit gum semantics when the provider fails", async () => {
    const result = await analyzeEphemeralConsumptionResilient(
      {
        generateStructured: vi.fn().mockRejectedValue(new Error("provider failure")),
      },
      request,
    );
    expect(result.source).toBe("deterministic_fallback");
    expect(result.analysis.selection).toMatchObject({
      sourceType: "ephemeral_environment",
      sourceId,
      displayName: "old chewing gum",
    });
    expect(result.analysis.classification.consumable).toBe(true);
    expect(result.analysis.consumeUnits).toBe(1);
    expect(result.analysis.resourceDeltas).toEqual([]);
    expect(result.analysis.materialization).toBeUndefined();
    expect(result.analysis.risks[0]).toMatchObject({
      description: expect.stringMatching(/contamination|nausea/i),
    });
  });

  it("rejects a provider response that grants a meaningful ephemeral benefit", async () => {
    const result = await analyzeEphemeralConsumptionResilient(
      {
        generateStructured: vi.fn().mockResolvedValue({
          data: {
            selection: {
              sourceType: "ephemeral_environment",
              sourceId,
              displayName: "old chewing gum",
              rationale: "The supplied gum matches.",
              confidence: 0.9,
            },
            classification: {
              consumable: true,
              substanceKind: "chewing gum",
              portionDescription: "one piece",
              freshnessAssessment: "old",
              confidence: 0.9,
            },
            requestedUnits: 1,
            consumeUnits: 1,
            resourceDeltas: [
              {
                resource: "energy",
                delta: 10,
                rationale: "Impossible benefit",
              },
            ],
            conditions: [],
            risks: [],
            narrationFacts: [],
            assumptions: [],
          },
          requestedModel: "test",
          actualModel: "test",
        }),
      },
      request,
    );
    expect(result.source).toBe("deterministic_fallback");
    expect(result.analysis.resourceDeltas).toEqual([]);
  });

  it("provides a funny deterministic narration without inventing mechanics", () => {
    const narration = deterministicEphemeralNarration({
      rawText: request.rawText,
      displayName: "old chewing gum",
      risks: [{ description: "Minor contamination", occurred: false }],
    });
    expect(narration).toMatch(/municipal|public infrastructure/i);
    expect(narration).toMatch(/no nutrition/i);
  });
});
