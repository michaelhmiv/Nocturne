import { describe, expect, it } from "vitest";
import type { MaterializationAnalysisRequest, MaterializationProposal } from "@nocturne/contracts";
import {
  buildMaterializationPrompt,
  validateMaterializationProposal,
} from "./materialization-analyzer.js";

const sourceId = "71000000-0000-4000-8000-000000000001";
const request: MaterializationAnalysisRequest = {
  requestedConcept: "a pet dog",
  locationId: "10000000-0000-4000-8000-000000000006",
  locationName: "Rear Alley",
  locationDescription: "A dim service alley in a dense coastal city.",
  worldContext: { timeOfDay: "evening" },
  sourceCandidates: [
    {
      sourceId,
      sourceType: "population_reservoir",
      locationId: "10000000-0000-4000-8000-000000000006",
      name: "Ordinary urban animals",
      description: "A bounded background population of ordinary urban animals.",
      semanticScope: { families: ["ordinary urban animal", "domestic animal"] },
      constraints: ["No exotic or supernatural animals."],
      capacity: 4,
      rarityPolicy: { ordinary: 0.85 },
      metadata: {},
    },
  ],
  reusableDefinitions: [],
};

const proposal: MaterializationProposal = {
  decision: "materialize",
  selectedSourceId: sourceId,
  definition: {
    definitionType: "animal",
    name: "Mixed-breed domestic dog",
    conceptSummary: "An ordinary mixed-breed domestic dog.",
    revisionPayload: { species: "domestic dog", ordinary: true },
  },
  instance: {
    displayName: "Thin brown stray",
    distinguishingTraits: ["thin", "brown coat", "torn blue collar"],
    condition: 72,
    state: { temperament: "cautious" },
  },
  semanticFingerprintBasis: ["domestic dog", "brown coat", "torn blue collar"],
  narrationFacts: ["A thin brown dog is present in the alley."],
  assumptions: ["The dog is an ordinary domestic animal."],
};

describe("bounded materialization analysis", () => {
  it("explicitly rejects catalogue and request-as-evidence behavior", () => {
    const prompt = buildMaterializationPrompt(request);
    expect(prompt).toContain(
      "No fixed animal, person, item, vehicle, business, or object catalogue",
    );
    expect(prompt).toContain("request itself is not evidence");
    expect(prompt).toContain(sourceId);
  });

  it("accepts an ordinary dog from the supplied urban-animal source", () => {
    const validated = validateMaterializationProposal(proposal, request);
    expect(validated.decision).toBe("materialize");
    expect(validated.selectedSourceId).toBe(sourceId);
    expect(validated.assumptions).toContain("Materialization source: Ordinary urban animals.");
  });

  it("rejects an unsupplied source", () => {
    expect(() =>
      validateMaterializationProposal(
        {
          ...proposal,
          selectedSourceId: "71000000-0000-4000-8000-000000000099",
        },
        request,
      ),
    ).toThrow(/unavailable authoritative source/i);
  });

  it("rejects materialization from a depleted source", () => {
    expect(() =>
      validateMaterializationProposal(proposal, {
        ...request,
        sourceCandidates: [{ ...request.sourceCandidates[0]!, capacity: 0 }],
      }),
    ).toThrow(/depleted source/i);
  });

  it("allows a clean rejection without creating entity semantics", () => {
    const rejected = validateMaterializationProposal(
      {
        decision: "reject",
        rejectionReason: "No supplied source permits an exotic tiger in this alley.",
        semanticFingerprintBasis: ["requested exotic tiger"],
        narrationFacts: [],
        assumptions: ["Ordinary urban animal sources exclude exotic animals."],
      },
      { ...request, requestedConcept: "a tiger" },
    );
    expect(rejected.decision).toBe("reject");
    expect(rejected).not.toHaveProperty("instance");
  });
});
