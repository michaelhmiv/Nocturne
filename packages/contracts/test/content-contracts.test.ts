import { describe, expect, it } from "vitest";
import {
  ActionExecutionResponseSchema,
  GeneratedDefinitionDraftSchema,
  NormalizeContentRequestSchema,
} from "../src/index.js";

const concepts = [
  ["character", "character.player"],
  ["custom character quality", "quality.character.custom"],
  ["skill", "skill.alien.gravity-drive-maintenance"],
  ["power", "power.shadow.transit"],
  ["weapon", "weapon.contract.magical"],
  ["vehicle", "vehicle.motorcycle.phasing"],
  ["residence", "location.residence.townhouse"],
  ["installed base system", "installation.medical-bay.hidden"],
  ["magical ritual", "ritual.magic.binding"],
  ["organization", "organization.faction"],
  ["long-term invention project", "project.invention.gravity-drive"],
  ["technology-magic hybrid", "artifact.hybrid.technomagic"],
] as const;

function draft(definitionType: string) {
  return {
    definitionType,
    name: definitionType,
    conceptSummary: "Original player-created content.",
    playerFantasy: "Supports an arbitrary player concept.",
    noveltyLevel: 2,
    originSource: "player_created",
    traits: [],
    effects: [],
    modes: [],
    requirements: [],
    costs: [],
    limitations: [],
    risks: [],
    signatures: [],
    counters: [],
    relationships: [
      {
        relationType: "associated_with",
        targetDefinitionId: "definition.example",
        parameters: { playerDefinedSubtype: definitionType },
      },
    ],
    acquisitionPath: { type: "built", parameters: { customWorkflow: true } },
    extensionPayload: { unknownPlayerSubtype: "kept" },
  };
}

describe("GeneratedDefinitionDraftSchema", () => {
  it.each(concepts)("represents a %s with an open definition type", (_name, definitionType) => {
    const parsed = GeneratedDefinitionDraftSchema.parse(draft(definitionType));
    expect(parsed.definitionType).toBe(definitionType);
    expect(parsed.relationships).toHaveLength(1);
    expect(parsed.extensionPayload).toEqual({ unknownPlayerSubtype: "kept" });
  });
});

describe("NormalizeContentRequestSchema", () => {
  it("accepts concise player invention concepts", () => {
    const parsed = NormalizeContentRequestSchema.parse({
      characterId: "10000000-0000-4000-8000-000000000001",
      residenceId: "10000000-0000-4000-8000-000000000002",
      rawConcept: "A pie oven",
      intendedUse: "Support the character's current goals",
    });

    expect(parsed.rawConcept).toBe("A pie oven");
  });

  it("still rejects an empty invention concept", () => {
    expect(() =>
      NormalizeContentRequestSchema.parse({
        characterId: "10000000-0000-4000-8000-000000000001",
        rawConcept: "   ",
      }),
    ).toThrow();
  });
});

describe("ActionExecutionResponseSchema", () => {
  it("preserves the player message for chat history", () => {
    const parsed = ActionExecutionResponseSchema.parse({
      eventId: "10000000-0000-4000-8000-000000000001",
      intentId: "10000000-0000-4000-8000-000000000002",
      resolutionId: "10000000-0000-4000-8000-000000000003",
      rawText: "Watch the alley.",
      outcomeGrade: "success",
      margin: 1,
      narration: "A shadow crosses the fire escape.",
      calculationTrace: [],
      informationGained: [],
      costs: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      idempotentReplay: false,
    });

    expect(parsed.rawText).toBe("Watch the alley.");
  });
});
