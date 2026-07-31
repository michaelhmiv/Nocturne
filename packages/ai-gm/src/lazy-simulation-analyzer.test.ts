import { describe, expect, it } from "vitest";
import type { LazySimulationProposal, LazySimulationRequest } from "@nocturne/contracts";
import {
  buildLazySimulationPrompt,
  validateLazySimulationProposal,
} from "./lazy-simulation-analyzer.js";

const dogId = "10000000-0000-4000-8000-000000000001";
const kitchenId = "10000000-0000-4000-8000-000000000002";
const yardId = "10000000-0000-4000-8000-000000000003";
const request: LazySimulationRequest = {
  entityId: dogId,
  definitionType: "animal",
  definitionName: "Mixed-breed domestic dog",
  lifecycleStatus: "active",
  condition: 80,
  state: { version: 7, hunger: 20, thirst: 30, resting: true, secured: true },
  locationId: kitchenId,
  elapsedSeconds: 3600,
  policy: {
    policyId: "72000000-0000-4000-8000-000000000001",
    policyVersion: "animal-lazy-v1",
    description: "Bounded unattended animal needs and behavior.",
    stateKeys: ["hunger", "thirst", "fatigue", "fear", "trust", "resting", "secured"],
    allowedOperationTypes: ["set_state_value", "adjust_condition", "move_entity"],
    constraints: ["Do not move through inaccessible routes."],
  },
  relevantFacts: ["The dog is secured inside the kitchen."],
  accessibleLocationIds: [kitchenId, yardId],
};

describe("lazy simulation analysis", () => {
  it("prefers bounded factual development over continuous agent fiction", () => {
    const prompt = buildLazySimulationPrompt(request);
    expect(prompt).toContain("Prefer no_change");
    expect(prompt).toContain("Do not create entities");
    expect(prompt).toContain("Do not move through inaccessible routes");
  });

  it("accepts gradual need changes on the supplied entity", () => {
    const proposal: LazySimulationProposal = {
      decision: "mutate",
      summary: "One hour of elapsed time modestly increased hunger and thirst.",
      operations: [
        {
          type: "set_state_value",
          entityRef: { kind: "existing", entityId: dogId },
          path: ["hunger"],
          value: 25,
          expectedVersion: 7,
          preconditionFactIds: [],
        },
      ],
      assumptions: ["The dog remained secured."],
      nextSimulationSeconds: 1800,
    };
    expect(validateLazySimulationProposal(proposal, request).decision).toBe("mutate");
  });

  it("rejects movement outside accessible locations", () => {
    expect(() =>
      validateLazySimulationProposal(
        {
          decision: "mutate",
          summary: "The dog moved across town.",
          operations: [
            {
              type: "move_entity",
              entityRef: { kind: "existing", entityId: dogId },
              locationRef: {
                kind: "existing",
                entityId: "10000000-0000-4000-8000-000000000099",
              },
              expectedVersion: 7,
              preconditionFactIds: [],
            },
          ],
          assumptions: [],
          nextSimulationSeconds: 3600,
        },
        request,
      ),
    ).toThrow(/inaccessible movement destination/i);
  });

  it("rejects autonomous operations for terminal entities", () => {
    expect(() =>
      validateLazySimulationProposal(
        {
          decision: "mutate",
          summary: "A dead entity acts.",
          operations: [
            {
              type: "set_state_value",
              entityRef: { kind: "existing", entityId: dogId },
              path: ["hunger"],
              value: 30,
              expectedVersion: 7,
              preconditionFactIds: [],
            },
          ],
          assumptions: [],
          nextSimulationSeconds: 3600,
        },
        { ...request, lifecycleStatus: "dead" },
      ),
    ).toThrow(/terminal entities/i);
  });
});
