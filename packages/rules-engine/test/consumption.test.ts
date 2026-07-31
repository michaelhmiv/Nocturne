import { describe, expect, it } from "vitest";
import type { ConsumableAnalysis } from "@nocturne/contracts";
import { resolveConsumptionMechanics } from "../src/consumption.js";

const base: ConsumableAnalysis = {
  selection: {
    sourceType: "entity",
    sourceId: "20000000-0000-4000-8000-000000000001",
    displayName: "Unfamiliar tonic",
    rationale: "The bottle is owned and labeled for oral use.",
    confidence: 0.9,
  },
  classification: {
    consumable: true,
    substanceKind: "medicinal tonic",
    portionDescription: "one measured dose",
    freshnessAssessment: "The seal is intact.",
    confidence: 0.85,
  },
  consumeUnits: 1,
  resourceDeltas: [{ resource: "energy", delta: 5, rationale: "The tonic is mildly stimulating." }],
  conditions: [],
  risks: [
    {
      description: "Mild nausea",
      chanceBasisPoints: 10_000,
      resourceDeltas: [
        { resource: "comfort", delta: -3, rationale: "The tonic may upset the stomach." },
      ],
      conditions: [],
    },
  ],
  narrationFacts: [],
  assumptions: [],
};

describe("consumption mechanics", () => {
  it("applies AI-proposed semantics but resolves risk deterministically", () => {
    const first = resolveConsumptionMechanics(base, "stable-server-seed");
    const replay = resolveConsumptionMechanics(base, "stable-server-seed");

    expect(first).toEqual(replay);
    expect(first.outcomeGrade).toBe("success_with_consequence");
    expect(first.resourceDeltas.map((effect) => effect.resource)).toEqual(["energy", "comfort"]);
  });

  it("does not randomly fail routine safe consumption", () => {
    const result = resolveConsumptionMechanics({ ...base, risks: [] }, "another-seed");
    expect(result.outcomeGrade).toBe("complete_success");
  });

  it("fails without applying effects when no source exists", () => {
    const result = resolveConsumptionMechanics(
      {
        ...base,
        selection: {
          sourceType: "none",
          displayName: "No matching substance",
          rationale: "Nothing in context satisfies the request.",
          confidence: 1,
        },
        classification: { ...base.classification, consumable: false },
        resourceDeltas: [],
      },
      "seed",
    );
    expect(result.outcomeGrade).toBe("failure");
    expect(result.resourceDeltas).toEqual([]);
  });
});
