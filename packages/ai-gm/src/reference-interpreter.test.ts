import { describe, expect, it } from "vitest";
import type {
  EntityReferenceInterpretation,
  EntityReferenceInterpretationRequest,
} from "@nocturne/contracts";
import {
  buildReferenceInterpretationPrompt,
  validateReferenceInterpretation,
} from "./reference-interpreter.js";

const dogA = "10000000-0000-4000-8000-000000000001";
const dogB = "10000000-0000-4000-8000-000000000002";
const request: EntityReferenceInterpretationRequest = {
  command: "I feed the dog.",
  viewpointId: "10000000-0000-4000-8000-000000000003",
  recentPlayerSafeText: ["The thin brown dog followed you home."],
  candidates: [
    {
      entityId: dogA,
      displayName: "Thin brown stray",
      definitionType: "animal",
      lifecycleStatus: "active",
      locationId: "10000000-0000-4000-8000-000000000004",
      aliases: ["Rufus", "the thin brown dog"],
      relationshipLabels: ["following"],
      relevanceScore: 40_000,
      accessible: true,
      present: true,
      supportingFactIds: ["fact:dog-a", "fact:following"],
    },
  ],
};

describe("persistent reference interpretation", () => {
  it("forbids invention and keeps search concepts distinct from references", () => {
    const prompt = buildReferenceInterpretationPrompt(request);
    expect(prompt).toContain("Never invent an entity or ID");
    expect(prompt).toContain("may express a search concept");
  });

  it("resolves one dominant persistent dog", () => {
    const result = validateReferenceInterpretation(
      {
        mentions: [
          {
            order: 1,
            mentionText: "the dog",
            mentionKind: "description",
            status: "resolved",
            selectedEntityId: dogA,
            candidateEntityIds: [dogA],
            confidenceBasisPoints: 9800,
            supportingFactIds: ["fact:dog-a", "fact:following"],
            requiresClarification: false,
            rationale: "One present dog is following the player and matches recent context.",
          },
        ],
      },
      request,
    );
    expect(result.mentions[0]?.selectedEntityId).toBe(dogA);
  });

  it("requires real multiple candidates for ambiguity", () => {
    const ambiguousRequest = {
      ...request,
      candidates: [
        request.candidates[0]!,
        {
          ...request.candidates[0]!,
          entityId: dogB,
          displayName: "Black dog",
          aliases: ["the black dog"],
          supportingFactIds: ["fact:dog-b"],
        },
      ],
    };
    const interpretation: EntityReferenceInterpretation = {
      mentions: [
        {
          order: 1,
          mentionText: "the dog",
          mentionKind: "description",
          status: "ambiguous",
          candidateEntityIds: [dogA, dogB],
          confidenceBasisPoints: 5000,
          supportingFactIds: ["fact:dog-a", "fact:dog-b"],
          requiresClarification: true,
          clarificationPrompt: "Did you mean the thin brown dog or the black dog?",
          rationale: "Two present dogs are plausible.",
        },
      ],
    };
    expect(
      validateReferenceInterpretation(interpretation, ambiguousRequest).mentions[0]?.status,
    ).toBe("ambiguous");
  });

  it("rejects an unsupplied selected entity", () => {
    expect(() =>
      validateReferenceInterpretation(
        {
          mentions: [
            {
              order: 1,
              mentionText: "the dog",
              mentionKind: "description",
              status: "resolved",
              selectedEntityId: dogB,
              candidateEntityIds: [dogB],
              confidenceBasisPoints: 9900,
              supportingFactIds: [],
              requiresClarification: false,
              rationale: "Unsupported entity.",
            },
          ],
        },
        request,
      ),
    ).toThrow(/unsupplied candidate/i);
  });
});
