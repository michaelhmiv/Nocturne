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
  relationships: [],
  acquisitionPath: { type: "researched", stages: 4, parameters: {} },
  extensionPayload: {},
  status: "provisional",
};

function invention(overrides: Record<string, unknown>) {
  return { ...baseDraft, ...overrides };
}

describe("validateGeneratedContent", () => {
  it.each([
    ["satellite-linked dimensional radar", {}],
    [
      "alien gravity-drive maintenance skill",
      {
        definitionType: "skill.alien_gravity_drive_maintenance",
        name: "Alien Gravity-Drive Maintenance",
        originSource: "alien_technical_training",
        acquisitionPath: { type: "trained", stages: 6, parameters: {} },
      },
    ],
    [
      "matter-phasing motorcycle",
      {
        definitionType: "vehicle.motorcycle.phase-capable",
        name: "Ghostline Motorcycle",
        modes: [
          {
            modeId: "phase",
            name: "Matter Phase",
            effects: [
              {
                effectId: "phase_through_matter",
                target: "vehicle_and_rider",
                strength: 6,
                duration: "one_round",
                parameters: {},
              },
            ],
            requirements: [],
            costs: [{ resource: "phase_charge", amount: 1, timing: "activation", parameters: {} }],
            signatures: [{ channel: "quantum_distortion", strength: 5, parameters: {} }],
          },
        ],
      },
    ],
    [
      "magically binding contract weapon",
      {
        definitionType: "weapon.contract.bound",
        name: "The Signed Edge",
        originSource: "legal_magic",
        traits: [{ name: "binding contract", type: "legal", parameters: {} }],
      },
    ],
    [
      "hidden medical bay installed in a townhouse basement",
      {
        definitionType: "residence.installation.medical_bay.hidden",
        name: "Townhouse Basement Medical Bay",
        requirements: [
          {
            phase: "installation",
            ruleId: "location.basement_with_utility_access",
            parameters: { hostType: "residence.townhouse" },
            severity: "hard",
          },
        ],
        relationships: [
          {
            relationType: "installed_in",
            targetInstanceId: "townhouse-instance",
            parameters: { room: "basement" },
          },
        ],
      },
    ],
  ])("accepts an original %s", (_name, overrides) => {
    expect(validateGeneratedContent(invention(overrides)).status).not.toBe("invalid");
  });

  it("returns structured remediation for an unbounded omniscient detector", () => {
    const result = validateGeneratedContent(
      invention({
        definitionType: "device.omniscient_detector",
        name: "Everyone Everywhere Detector",
        effects: [
          {
            effectId: "detect_everyone_everywhere",
            target: "everyone_everywhere",
            strength: 10,
            range: "unlimited",
            precision: 10,
            parameters: {},
          },
        ],
        limitations: [],
        counters: [],
        requirements: [],
        costs: [],
        signatures: [],
        acquisitionPath: { type: "immediate", parameters: {} },
      }),
    );

    expect(result.status).toBe("invalid");
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "magnitude.immediate_acquisition",
        "magnitude.missing_limitation",
        "magnitude.missing_counterplay",
        "magnitude.missing_support",
        "counterplay.no_signature",
      ]),
    );
    expect(result.issues.flatMap((issue) => issue.suggestions).join(" ")).toMatch(
      /acquisition|limitation|cost|counter/i,
    );
  });
});
