import { describe, expect, it } from "vitest";
import type { ConsumableAnalysis, ConsumptionAnalysisRequest } from "@nocturne/contracts";
import {
  buildConsumableAnalysisPrompt,
  validateConsumableAnalysisAgainstContext,
} from "./consumable-analyzer.js";

const actorId = "10000000-0000-4000-8000-000000000001";
const entityId = "20000000-0000-4000-8000-000000000001";
const poolId = "30000000-0000-4000-8000-000000000001";

const request: ConsumptionAnalysisRequest = {
  actorId,
  rawText: "I eat something",
  locationName: "Unit 3B",
  locationDescription: "A modest apartment kitchen.",
  actorState: { condition: 80 },
  candidates: [
    {
      sourceType: "entity",
      sourceId: entityId,
      name: "Blue fungal ration",
      description: "A sealed edible ration grown from an unfamiliar bioluminescent fungus.",
      access: "owned",
      quantity: 2,
      state: { sealed: true },
      constraints: [],
    },
    {
      sourceType: "ambient_pool",
      sourceId: poolId,
      name: "Sparse kitchen provisions",
      description: "A few ordinary low-cost pantry staples appropriate to the apartment.",
      access: "ambient",
      quantity: 3,
      state: {},
      constraints: ["No specialty, luxury, celebratory, or prepared foods."],
    },
  ],
};

const analysis: ConsumableAnalysis = {
  selection: {
    sourceType: "entity",
    sourceId: entityId,
    displayName: "Blue fungal ration",
    rationale: "It is owned, sealed, described as edible, and matches the generic request.",
    confidence: 0.94,
  },
  classification: {
    consumable: true,
    substanceKind: "fungal ration",
    portionDescription: "one sealed ration",
    freshnessAssessment: "Sealed and apparently stable.",
    confidence: 0.9,
  },
  consumeUnits: 1,
  resourceDeltas: [
    { resource: "satiety", delta: 12, rationale: "A full ration provides substantial food." },
  ],
  conditions: [
    {
      name: "Faint bioluminescent afterglow",
      key: "bioluminescent_afterglow",
      intensity: 1,
      durationSeconds: 900,
      rationale: "The fungal pigments plausibly remain visible briefly.",
    },
  ],
  risks: [],
  narrationFacts: ["The sealed fungal ration is consumed."],
  assumptions: ["The package labeling is reliable."],
};

describe("AI-derived consumable semantics", () => {
  it("supports arbitrary fictional substances without a food catalogue", () => {
    expect(validateConsumableAnalysisAgainstContext(analysis, request)).toEqual(analysis);
  });

  it("rejects an AI-selected source that is not in authoritative context", () => {
    expect(() =>
      validateConsumableAnalysisAgainstContext(
        {
          ...analysis,
          selection: {
            ...analysis.selection,
            sourceId: "40000000-0000-4000-8000-000000000001",
          },
        },
        request,
      ),
    ).toThrow(/outside the authoritative context/);
  });

  it("passes ambient constraints to the model and explicitly avoids catalogue logic", () => {
    const prompt = buildConsumableAnalysisPrompt(request);
    expect(prompt).toContain("There is no food catalogue");
    expect(prompt).toContain("No specialty, luxury, celebratory, or prepared foods");
    expect(prompt).toContain(poolId);
  });

  it("prevents materialization beyond an ambient pool allowance", () => {
    const ambient: ConsumableAnalysis = {
      ...analysis,
      selection: {
        sourceType: "ambient_pool",
        sourceId: poolId,
        displayName: "Plain crackers",
        rationale: "A mundane pantry item consistent with the pool.",
        confidence: 0.8,
      },
      consumeUnits: 4,
      materialization: {
        name: "Plain crackers",
        conceptSummary: "A sleeve of inexpensive plain crackers.",
        descriptiveTraits: ["dry", "ordinary", "shelf-stable"],
        unitsCreated: 4,
      },
    };

    expect(() => validateConsumableAnalysisAgainstContext(ambient, request)).toThrow(
      /exceeds the available source quantity|exceeds the ambient resource allowance/,
    );
  });
});
