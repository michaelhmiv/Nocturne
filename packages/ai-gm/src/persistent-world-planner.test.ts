import { describe, expect, it } from "vitest";
import type { WorldActionPlannerRequest, WorldActionPlannerResult } from "@nocturne/contracts";
import {
  buildPersistentWorldPlannerPrompt,
  validatePersistentWorldPlan,
} from "./persistent-world-planner.js";

const actorId = "10000000-0000-4000-8000-000000000001";
const streetId = "10000000-0000-4000-8000-000000000002";
const targetId = "10000000-0000-4000-8000-000000000003";
const inventedId = "10000000-0000-4000-8000-000000000099";

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

  it("allows a known area ID supplied as a player-visible fact value", () => {
    const roomId = "10000000-0000-4000-8000-000000000004";
    const observationRequest: WorldActionPlannerRequest = {
      command: "I look around the room.",
      actorId,
      playerKnownFacts: [
        { entityId: actorId, claim: "entity.location", value: roomId },
        { entityId: actorId, claim: "entity.version", value: 2 },
      ],
      resolvedEntityIds: [],
      activePlanSummary: null,
      enabledHandlers: ["search"],
    };
    const observationResult: WorldActionPlannerResult = {
      primaryKind: "search",
      requiresClarification: false,
      rationale: "The player is observing the known current area.",
      plan: {
        originalCommand: observationRequest.command,
        exclusivePhysical: false,
        steps: [
          {
            order: 1,
            kind: "search",
            description: "Observe the current room.",
            intentPayload: {
              areaId: roomId,
              requestedConcept: "surroundings",
              rawText: observationRequest.command,
            },
            referencedEntities: [
              { entityId: actorId, role: "actor", expectedVersion: 2 },
              { entityId: roomId, role: "location" },
            ],
          },
        ],
        dependencies: [],
      },
    };

    expect(validatePersistentWorldPlan(observationResult, observationRequest).plan?.steps[0]).toMatchObject(
      {
        kind: "search",
        intentPayload: { areaId: roomId },
      },
    );
  });

  it("forbids invented persistent entity IDs in referenced entities", () => {
    expect(() =>
      validatePersistentWorldPlan(
        {
          ...result,
          plan: {
            ...result.plan!,
            steps: [
              {
                ...result.plan!.steps[0]!,
                referencedEntities: [{ entityId: inventedId, role: "location" }],
              },
            ],
            dependencies: [],
          },
        },
        request,
      ),
    ).toThrow(/absent from player-visible planner context/i);
  });

  it("forbids invented IDs hidden inside handler payloads", () => {
    expect(() =>
      validatePersistentWorldPlan(
        {
          ...result,
          plan: {
            ...result.plan!,
            steps: [
              {
                ...result.plan!.steps[0]!,
                intentPayload: {
                  destinationId: inventedId,
                  rawText: "I walk into an invented location",
                },
              },
            ],
            dependencies: [],
          },
        },
        request,
      ),
    ).toThrow(/absent from player-visible planner context/i);
  });

  it("makes the authority boundary explicit in the prompt", () => {
    const prompt = buildPersistentWorldPlannerPrompt(request);
    expect(prompt).toContain("Do not decide outcomes");
    expect(prompt).toContain("after_arrival");
    expect(prompt).toContain("Discovery is separate from ownership");
    expect(prompt).toContain("PLAYER-KNOWN FACTS");
  });
});
