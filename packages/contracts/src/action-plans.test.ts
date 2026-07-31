import { describe, expect, it } from "vitest";
import { PersistentActionPlanProposalSchema } from "./action-plans.js";

const actor = "10000000-0000-4000-8000-000000000001";
const street = "10000000-0000-4000-8000-000000000002";
const target = "10000000-0000-4000-8000-000000000003";

describe("persistent action plans", () => {
  it("represents travel as a durable prerequisite instead of a skipped step", () => {
    const plan = PersistentActionPlanProposalSchema.parse({
      originalCommand: "Walk into the street and attack him.",
      exclusivePhysical: true,
      steps: [
        {
          order: 1,
          kind: "move",
          description: "Travel into the street.",
          intentPayload: { destinationId: street },
          referencedEntities: [
            { entityId: actor, role: "actor", expectedVersion: 1 },
            { entityId: street, role: "location", expectedVersion: 0 },
          ],
        },
        {
          order: 2,
          kind: "attack",
          description: "Attempt to attack the referenced target.",
          intentPayload: { targetId: target },
          referencedEntities: [
            { entityId: actor, role: "actor", expectedVersion: 1 },
            { entityId: target, role: "target", expectedVersion: 4 },
          ],
        },
      ],
      dependencies: [
        {
          stepOrder: 2,
          dependsOnStepOrder: 1,
          dependencyType: "after_arrival",
          parameters: { destinationId: street },
        },
      ],
    });
    expect(plan.steps[1]?.kind).toBe("attack");
    expect(plan.dependencies[0]?.dependencyType).toBe("after_arrival");
  });

  it("rejects forward and self dependencies", () => {
    expect(() =>
      PersistentActionPlanProposalSchema.parse({
        originalCommand: "Do two things.",
        steps: [
          {
            order: 1,
            kind: "first",
            description: "First step.",
            intentPayload: {},
            referencedEntities: [],
          },
          {
            order: 2,
            kind: "second",
            description: "Second step.",
            intentPayload: {},
            referencedEntities: [],
          },
        ],
        dependencies: [
          {
            stepOrder: 1,
            dependsOnStepOrder: 2,
            dependencyType: "after_step_completed",
            parameters: {},
          },
        ],
      }),
    ).toThrow(/earlier step/i);
  });
});
