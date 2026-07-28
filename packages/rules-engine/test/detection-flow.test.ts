import type { GeneratedDefinitionDraft } from "@nocturne/contracts";
import { describe, expect, it } from "vitest";
import { buildDetectionOperations, deriveDetectionContest, resolveContest } from "../src/index.js";

const draft: GeneratedDefinitionDraft = {
  definitionType: "sensor",
  name: "Array",
  conceptSummary: "Sensor",
  playerFantasy: "See movement",
  noveltyLevel: 1,
  originSource: "technology",
  traits: [],
  effects: [{ effectId: "sense", target: "movement", strength: 4, parameters: {} }],
  modes: [],
  requirements: [],
  costs: [],
  limitations: ["local"],
  risks: [],
  signatures: [],
  counters: ["masking"],
  relationships: [],
  acquisitionPath: { type: "built", parameters: {} },
  extensionPayload: {},
  status: "provisional",
};

describe("detection flow", () => {
  it("derives base scores without AI-selected numbers", () => {
    const contest = deriveDetectionContest({
      method: { instanceId: "1", condition: 100, draft, installed: true },
      environment: { clutter: 1, darkness: 2, coverageSupport: 1 },
      opposition: { concealment: 3, countermeasure: 0 },
      operator: { competence: 1 },
      proposedModifiers: [],
    });
    expect(contest.actorScore).toBeGreaterThan(contest.targetScore);
  });
  it("is deterministic for identical seed and inputs", () => {
    const first = resolveContest({
      actionType: "detect",
      actorScore: 7,
      targetScore: 5,
      seed: "server-seed",
    });
    expect(
      resolveContest({ actionType: "detect", actorScore: 7, targetScore: 5, seed: "server-seed" }),
    ).toEqual(first);
  });
  it("creates information only for informative outcomes", () => {
    expect(
      buildDetectionOperations({
        outcome: "failure",
        actorId: "40000000-0000-4000-8000-000000000001",
        methodInstanceId: "40000000-0000-4000-8000-000000000002",
        targetId: "40000000-0000-4000-8000-000000000003",
        occurredAt: new Date(0).toISOString(),
      }).some((operation) => operation.type === "create_information_asset"),
    ).toBe(false);
  });
});
