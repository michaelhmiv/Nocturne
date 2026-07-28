import { describe, expect, it } from "vitest";
import { GeneratedDefinitionDraftSchema } from "../src/index.js";

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
