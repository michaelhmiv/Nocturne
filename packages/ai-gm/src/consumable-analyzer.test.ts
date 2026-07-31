import { describe, expect, it } from "vitest";
import {
  ConsumableAnalysisSchema,
  type ConsumableAnalysis,
  type ConsumptionAnalysisRequest,
} from "@nocturne/contracts";
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
  requestedUnits: 1,
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
    const result = validateConsumableAnalysisAgainstContext(analysis, request);
    expect(result.selection).toEqual(analysis.selection);
    expect(result.classification).toEqual(analysis.classification);
    expect(result.consumeUnits).toBe(1);
    expect(result.resourceDeltas).toEqual(analysis.resourceDeltas);
    expect(result.conditions).toEqual(analysis.conditions);
    expect(result.quantityResolution).toEqual({
      requestedUnits: 1,
      availableUnits: 2,
      appliedUnits: 1,
      limitedByAvailability: false,
      limitedByEngine: false,
    });
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
    expect(prompt).toContain(
      "Do not select an ambient pool merely to explain why it cannot satisfy",
    );
    expect(prompt).toContain("Set consumeUnits to 0");
    expect(prompt).toContain(poolId);
  });

  it("reconciles five requested servings to one authoritative serving", () => {
    const result = validateConsumableAnalysisAgainstContext(
      {
        ...analysis,
        requestedUnits: 5,
        consumeUnits: 5,
      },
      {
        ...request,
        rawText: "Eat 5 bowls of the ration",
        candidates: [{ ...request.candidates[0]!, quantity: 1 }],
      },
    );

    expect(result.consumeUnits).toBe(1);
    expect(result.quantityResolution).toEqual({
      requestedUnits: 5,
      availableUnits: 1,
      appliedUnits: 1,
      limitedByAvailability: true,
      limitedByEngine: false,
    });
    expect(result.resourceDeltas[0]?.delta).toBe(2);
    expect(result.narrationFacts.join(" ")).toContain("Requested 5 units; 1 unit can be consumed");
  });

  it("repairs a zero-unit model answer when a consumable source is available", () => {
    const result = validateConsumableAnalysisAgainstContext(
      { ...analysis, consumeUnits: 0 },
      request,
    );
    expect(result.consumeUnits).toBe(1);
    expect(result.quantityResolution?.appliedUnits).toBe(1);
  });

  it("normalizes no matching source to a committed zero-unit failure", () => {
    const result = validateConsumableAnalysisAgainstContext(
      {
        ...analysis,
        selection: {
          sourceType: "none",
          displayName: "No matching food",
          rationale: "No authoritative candidate matches.",
          confidence: 0.95,
        },
        classification: {
          ...analysis.classification,
          consumable: false,
          substanceKind: "unavailable",
        },
        requestedUnits: 2,
        consumeUnits: 0,
        resourceDeltas: [{ resource: "satiety", delta: 10, rationale: "Unsupported effect." }],
        conditions: [],
        risks: [],
      },
      { ...request, candidates: [] },
    );

    expect(result.consumeUnits).toBe(0);
    expect(result.resourceDeltas).toEqual([]);
    expect(result.conditions).toEqual([]);
    expect(result.risks).toEqual([]);
    expect(result.quantityResolution).toEqual({
      requestedUnits: 2,
      availableUnits: 0,
      appliedUnits: 0,
      limitedByAvailability: true,
      limitedByEngine: false,
    });
  });

  it("normalizes an unavailable 12-pie ambient answer instead of failing validation", () => {
    const modelResult = ConsumableAnalysisSchema.parse({
      selection: {
        sourceType: "ambient_pool",
        sourceId: poolId,
        displayName: "Sparse kitchen provisions",
        rationale: "The sparse provisions cannot plausibly provide twelve pies.",
        confidence: 0.2,
      },
      classification: {
        consumable: false,
        substanceKind: "unavailable",
        portionDescription: "No pies available",
        freshnessAssessment: "Not applicable",
        confidence: 0.1,
      },
      requestedUnits: 12,
      consumeUnits: 0,
      materialization: {
        name: "Sparse kitchen provisions",
        conceptSummary: "A few ordinary inexpensive pantry staples.",
        descriptiveTraits: ["mundane", "sparse"],
        unitsCreated: 0,
      },
      resourceDeltas: [],
      conditions: [],
      risks: [],
      narrationFacts: ["No pies are available."],
      assumptions: ["The pool cannot produce twelve pies."],
    });

    const result = validateConsumableAnalysisAgainstContext(modelResult, {
      ...request,
      rawText: "I eat 12 pies",
      candidates: [request.candidates[1]!],
    });

    expect(result.selection.sourceType).toBe("none");
    expect(result.selection).not.toHaveProperty("sourceId");
    expect(result.materialization).toBeUndefined();
    expect(result.consumeUnits).toBe(0);
    expect(result.resourceDeltas).toEqual([]);
    expect(result.quantityResolution).toEqual({
      requestedUnits: 12,
      availableUnits: 0,
      appliedUnits: 0,
      limitedByAvailability: true,
      limitedByEngine: false,
    });
  });

  it("still requires positive materialization for actual ambient consumption", () => {
    expect(() =>
      ConsumableAnalysisSchema.parse({
        ...analysis,
        selection: {
          sourceType: "ambient_pool",
          sourceId: poolId,
          displayName: "Plain crackers",
          rationale: "The pantry can produce crackers.",
          confidence: 0.8,
        },
        consumeUnits: 1,
        materialization: {
          name: "Plain crackers",
          conceptSummary: "A small sleeve of plain crackers.",
          descriptiveTraits: ["ordinary"],
          unitsCreated: 0,
        },
      }),
    ).toThrow(/positive materialization quantity/);
  });

  it("does not consume or apply effects for a selected non-consumable source", () => {
    const result = validateConsumableAnalysisAgainstContext(
      {
        ...analysis,
        classification: {
          ...analysis.classification,
          consumable: false,
          substanceKind: "industrial material",
        },
        consumeUnits: 0,
        resourceDeltas: [{ resource: "satiety", delta: 12, rationale: "Unsupported effect." }],
      },
      request,
    );

    expect(result.consumeUnits).toBe(0);
    expect(result.resourceDeltas).toEqual([]);
    expect(result.quantityResolution?.availableUnits).toBe(2);
    expect(result.quantityResolution?.appliedUnits).toBe(0);
  });

  it("caps ambient materialization to the authoritative pool instead of throwing", () => {
    const ambient: ConsumableAnalysis = {
      ...analysis,
      selection: {
        sourceType: "ambient_pool",
        sourceId: poolId,
        displayName: "Plain crackers",
        rationale: "A mundane pantry item consistent with the pool.",
        confidence: 0.8,
      },
      requestedUnits: 4,
      consumeUnits: 4,
      materialization: {
        name: "Plain crackers",
        conceptSummary: "A sleeve of inexpensive plain crackers.",
        descriptiveTraits: ["dry", "ordinary", "shelf-stable"],
        unitsCreated: 4,
      },
    };

    const result = validateConsumableAnalysisAgainstContext(ambient, request);
    expect(result.consumeUnits).toBe(3);
    expect(result.materialization?.unitsCreated).toBe(3);
    expect(result.quantityResolution?.limitedByAvailability).toBe(true);
  });
});
