import { describe, expect, it } from "vitest";
import type { ConsumableAnalysis } from "@nocturne/contracts";
import { resolveConsumptionMechanics } from "./consumption.js";

const analysis: ConsumableAnalysis = {
  selection: {
    sourceType: "entity",
    sourceId: "20000000-0000-4000-8000-000000000001",
    displayName: "Oatmeal packet",
    rationale: "It is the only matching accessible food.",
    confidence: 1,
  },
  classification: {
    consumable: true,
    substanceKind: "oatmeal",
    portionDescription: "one packet",
    freshnessAssessment: "Shelf-stable and intact.",
    confidence: 1,
  },
  requestedUnits: 5,
  consumeUnits: 1,
  quantityResolution: {
    requestedUnits: 5,
    availableUnits: 1,
    appliedUnits: 1,
    limitedByAvailability: true,
    limitedByEngine: false,
  },
  resourceDeltas: [
    { resource: "satiety", delta: 2, rationale: "One packet provides modest satiety." },
  ],
  conditions: [],
  risks: [],
  narrationFacts: ["Only one of five requested servings is available."],
  assumptions: [],
};

describe("consumption quantity resolution", () => {
  it("grades a fulfilled available portion as partial success", () => {
    const result = resolveConsumptionMechanics(analysis, "stable-test-seed");
    expect(result.outcomeGrade).toBe("partial_success");
    expect(result.resourceDeltas).toEqual(analysis.resourceDeltas);
    expect(result.calculationTrace).toContain("consume_requested_units=5");
    expect(result.calculationTrace).toContain("consume_units=1");
  });

  it("keeps a fully available ordinary consumption as complete success", () => {
    const result = resolveConsumptionMechanics(
      {
        ...analysis,
        requestedUnits: 1,
        quantityResolution: {
          requestedUnits: 1,
          availableUnits: 1,
          appliedUnits: 1,
          limitedByAvailability: false,
          limitedByEngine: false,
        },
      },
      "stable-test-seed",
    );
    expect(result.outcomeGrade).toBe("complete_success");
  });
});
