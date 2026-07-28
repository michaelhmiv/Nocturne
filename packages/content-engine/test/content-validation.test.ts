import { describe, expect, it } from "vitest";
import { validateGeneratedContent } from "../src/index.js";

const baseDraft = {
  definitionType: "installed_sensor_system",
  name: "Quantum Parallax Array",
  conceptSummary: "Detects dimensional displacement through gravitational anomalies.",
  playerFantasy: "A strange satellite-linked radar for portal activity.",
  noveltyLevel: 2,
  originSource: "technology",
  traits: [],
  effects: [
    {
      effectId: "sense",
      target: "dimensional anomaly",
      strength: 4,
      parameters: {},
    },
  ],
  modes: [],
  requirements: [],
  costs: [],
  limitations: ["Slow calibration"],
  risks: ["False anomalies"],
  signatures: [{ channel: "gravitational", strength: 3, parameters: {} }],
  counters: ["Gravitational masking"],
  acquisitionPath: { type: "researched", stages: 4, parameters: {} },
  extensionPayload: {},
  status: "provisional",
};

describe("validateGeneratedContent", () => {
  it("accepts an extensible custom definition", () => {
    const result = validateGeneratedContent(baseDraft);
    expect(result.status).toBe("valid");
  });

  it("rejects unbounded high-magnitude content", () => {
    const result = validateGeneratedContent({
      ...baseDraft,
      effects: [{ ...baseDraft.effects[0], strength: 9 }],
      limitations: [],
      counters: [],
      requirements: [],
      costs: [],
    });
    expect(result.status).toBe("invalid");
  });
});
