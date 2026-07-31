import { describe, expect, it } from "vitest";
import type {
  SearchDiscoveryAnalysis,
  SearchDiscoveryAnalysisRequest,
} from "@nocturne/contracts";
import { buildSearchAnalysisPrompt, validateSearchAnalysis } from "./search-analyzer.js";

const dogId = "10000000-0000-4000-8000-000000000001";
const sourceId = "71000000-0000-4000-8000-000000000001";
const request: SearchDiscoveryAnalysisRequest = {
  rawText: "I search the alley for a pet dog.",
  actorId: "10000000-0000-4000-8000-000000000002",
  areaId: "10000000-0000-4000-8000-000000000003",
  areaName: "Rear Alley",
  areaDescription: "A dim service alley with dumpsters and delivery access.",
  requestedConcept: "a pet dog",
  actorFacts: ["fact:actor: alert and able to search"],
  areaFacts: ["fact:area: dim lighting and clutter"],
  existingCandidates: [],
  materializationSourceIds: [sourceId],
};

const materializedAnalysis: SearchDiscoveryAnalysis = {
  targetFamily: "animal",
  requestedConcept: "ordinary domestic dog",
  mayMaterialize: true,
  selectedMaterializationSourceId: sourceId,
  actorScore: 4,
  targetScore: 5,
  modifiers: [],
  successDescription: "You locate a specific dog in the alley.",
  consequenceDescription: "You locate a dog, but it is frightened and ready to flee.",
  partialDescription: "You hear barking and find fresh paw prints.",
  progressDescription: "You find a trail leading toward the next block.",
  failureDescription: "You find no meaningful sign of a dog.",
  reversalDescription: "Your search startles nearby animals and draws unwanted attention.",
  assumptions: ["The source permits ordinary urban animals."],
};

describe("search and discovery analysis", () => {
  it("preserves search as a contest and does not equate a request with existence", () => {
    const prompt = buildSearchAnalysisPrompt(request);
    expect(prompt).toContain("asking for something is not evidence");
    expect(prompt).toContain("Finding an entity creates observation/knowledge only");
  });

  it("accepts bounded materialization only from a supplied source", () => {
    expect(validateSearchAnalysis(materializedAnalysis, request).mayMaterialize).toBe(true);
  });

  it("prefers an existing candidate over materialization", () => {
    const existingRequest = {
      ...request,
      existingCandidates: [
        {
          entityId: dogId,
          name: "Thin brown stray",
          conceptSummary: "An ordinary domestic dog.",
          hidden: true,
          concealment: 30,
          supportingFactIds: ["fact:hidden-dog"],
        },
      ],
    };
    const existing = validateSearchAnalysis(
      {
        ...materializedAnalysis,
        selectedExistingEntityId: dogId,
        mayMaterialize: false,
        selectedMaterializationSourceId: undefined,
      },
      existingRequest,
    );
    expect(existing.selectedExistingEntityId).toBe(dogId);
  });

  it("rejects an unavailable entity or source", () => {
    expect(() =>
      validateSearchAnalysis(
        {
          ...materializedAnalysis,
          selectedMaterializationSourceId: "71000000-0000-4000-8000-000000000099",
        },
        request,
      ),
    ).toThrow(/unavailable materialization source/i);
  });
});
