import type { GeneratedDefinitionDraft } from "@nocturne/contracts";
import { describe, expect, it } from "vitest";
import { evaluateInstallation } from "../src/installation.js";

const draft: GeneratedDefinitionDraft = {
  definitionType: "installed_sensor_system",
  name: "Nightglass Array",
  conceptSummary: "A concealed thermal and acoustic surveillance array.",
  playerFantasy: "Watch the alley without exposing the operator.",
  noveltyLevel: 2,
  originSource: "technology",
  traits: [],
  effects: [],
  modes: [
    {
      modeId: "scan",
      name: "Scan",
      effects: [{ effectId: "sense", target: "movement", strength: 4, parameters: {} }],
      requirements: [
        {
          phase: "installation",
          ruleId: "capacity.power",
          parameters: { minimum: 2 },
          severity: "hard",
        },
      ],
      costs: [],
      signatures: [{ channel: "electromagnetic", strength: 2, parameters: {} }],
    },
  ],
  requirements: [
    {
      phase: "installation",
      ruleId: "capacity.space",
      parameters: { minimum: 2 },
      severity: "hard",
    },
  ],
  costs: [],
  limitations: ["Fixed coverage"],
  risks: ["Can be discovered"],
  signatures: [],
  counters: ["Cut power"],
  relationships: [],
  acquisitionPath: { type: "built", parameters: {} },
  extensionPayload: {},
  status: "provisional",
};

describe("installation evaluation", () => {
  it("accepts a supported apartment installation", () => {
    expect(evaluateInstallation(draft, { space: 3, power: 2 }).fits).toBe(true);
  });
  it("reports each deficient capacity", () => {
    const result = evaluateInstallation(draft, { space: 1, power: 0 });
    expect(result.fits).toBe(false);
    expect(result.issues.map((issue) => issue.capacity)).toEqual(["space", "power"]);
  });
});
