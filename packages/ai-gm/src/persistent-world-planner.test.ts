import { describe, expect, it } from "vitest";
import type {
  WorldActionPlannerRequest,
  WorldActionPlannerResult,
} from "@nocturne/contracts";
import {
  buildPersistentWorldPlannerPrompt,
  validatePersistentWorldPlan,
} from "./persistent-world-planner.js";

const actorId = "10000000-0000-4000-8000-000000000001";
const streetId = "10000000-0000-4000-8000-000000000002";
const targetId = "10000000-0000-4000-8000-000000000003";

const request: WorldActionPlannerRequest = {
  command: "I walk into the street and attack him.",
  actorId,
  playerKnownFacts: [
    { entityId: actorId, claim: "entity.version", value: 2 },
    { entityId: streetId, claim: "entity.name", value: "Foundry Street" },
    { entityId: targetId, claim: "entity.name", value: "The man from the alley" },
  ],
  resolvedEntityIds: [streetId, targetId],
  activePlanSummary: null,
  enabledHandlers: ["move", "combat"],
};

const result: WorldActionPlannerResult = {
  primaryKind: "move",
  requiresClarification: false,
  rationale: "Movement is required before the contested action can be attempted.",
  plan: {
    originalCommand: request.command,
    exclusivePhysical: true,
    steps: [
      {
        order: 1,
        kind: "move",
        description: "Travel into Foundry Street.",
        intentPayload: { destinationId: streetId, rawText: "I walk into the street" },
        referencedEntities: [
          { entityId: actorId, role: "actor", expectedVersion: 2 },
          { entityId: streetId, role: "location" },
        ],
      },
      {
        order: 2,
        kind: "combat",
        description: "Attempt to attack the referenced man after arrival.",
        intentPayload: { targetId, rawText: "attack him" },
        referencedEntities: [
          { entityId: actorId, role: "actor", expectedVersion: 2 },
          { entityId: targetId, role: "target" },
        ],
      },
    ],
    dependencies: [
      {
        stepOrder: 2,
        dependsOnStepOrder: 1,
        dependencyType: "after_arrival",
        parameters: { destinationId: streetId },
      },
    ],
  },
};

describe("persistent world planner", () => {
  it("requires travel to survive as an arrival dependency", () => {
    const validated = validatePersistentWorldPlan(result, request);
    expect(validated.plan?.dependencies[0]?.dependencyType).toBe("after_arrival");
    expect(validated.plan?.steps[1]?.kind).toBe("combat");
  });

  it("forbids invented persistent entity IDs", () => {
    expect(() =>
      validatePersistentWorldPlan(
        {
          ...result,
          plan: {
            ...result.plan!,
            steps: [
              {
                ...result.plan!.steps[0]!,
                referencedEntities: [
                  {
                    entityId: "10000000-0000-4000-8000-000000000099",
                    role: "location",
                  },
                ],
              },
            ],
            dependencies: [],
          },
        },
        request,
      ),
    ).toThrow(/unsupplied persistent entity/i);
  });

  it("makes the authority boundary explicit in the prompt", () => {
    const prompt = buildPersistentWorldPlannerPrompt(request);
    expect(prompt).toContain("Do not decide outcomes");
    expect(prompt).toContain("after_arrival");
    expect(prompt).toContain("Discovery is separate from ownership");
  });
});
