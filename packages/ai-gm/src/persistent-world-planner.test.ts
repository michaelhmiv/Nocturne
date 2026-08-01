import { describe, expect, it, vi } from "vitest";
import type {
  AffordanceAssessment,
  WorldActionPlannerRequest,
  WorldActionPlannerResult,
} from "@nocturne/contracts";
import { NOCTURNE_GAME_CONSTITUTION } from "./game-constitution.js";
import {
  buildPersistentWorldPlannerPrompt,
  planPersistentWorldAction,
  validatePersistentWorldPlan,
} from "./persistent-world-planner.js";

const actorId = "10000000-0000-4000-8000-000000000001";
const streetId = "10000000-0000-4000-8000-000000000002";
const targetId = "10000000-0000-4000-8000-000000000003";
const inventedId = "10000000-0000-4000-8000-000000000099";

const gameMasterContext = (command: string, locationId: string) => ({
  constitution: NOCTURNE_GAME_CONSTITUTION,
  currentCommand: command,
  currentScene: {
    locationId,
    locationName: "Foundry Street",
    locationDescription: "An ordinary urban street.",
    summary: "The player is standing near the curb.",
    unresolvedThreads: [],
  },
  recentTurns: [
    {
      requestId: "10000000-0000-4000-8000-000000000010",
      command: "I ate an oatmeal packet.",
      playerSafeResult: "The oatmeal was bland but filling.",
      eventIds: ["10000000-0000-4000-8000-000000000011"],
      occurredAt: "2026-08-01T12:00:00.000Z",
    },
  ],
  relevantMemories: [],
  playerKnownFacts: [],
  activePlan: null,
  estimatedTokens: 500,
});

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
  gameMasterContext: gameMasterContext("I walk into the street and attack him.", streetId),
};

const combatAssessment: AffordanceAssessment = {
  terminalIntent: "combat",
  premises: [],
  requiresSearch: false,
  requiresClarification: false,
  rationale: "The attack is the terminal intent; walking is a prerequisite.",
};

const result: WorldActionPlannerResult = {
  primaryKind: "combat",
  requiresClarification: false,
  rationale: "Movement is required before the terminal combat action can be attempted.",
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

function gumRequest(): WorldActionPlannerRequest {
  const command = "I eat gum off a light pole.";
  return {
    command,
    actorId,
    playerKnownFacts: [{ entityId: actorId, claim: "entity.version", value: 2 }],
    resolvedEntityIds: [],
    activePlanSummary: null,
    enabledHandlers: ["consume", "search", "interact"],
    gameMasterContext: gameMasterContext(command, streetId),
  };
}

const gumAssessment: AffordanceAssessment = {
  terminalIntent: "consume",
  premises: [
    {
      text: "gum",
      concept: "old chewing gum",
      role: "object",
      status: "plausible_ephemeral",
      persistenceReason: "It is low-value and immediately consumed.",
      advantageCategories: ["none"],
      potentialConsequences: ["unpleasant taste", "minor contamination risk"],
    },
    {
      text: "light pole",
      concept: "generic municipal light pole",
      role: "source",
      status: "plausible_ephemeral",
      persistenceReason: "It is incidental scenery and remains unchanged.",
      advantageCategories: ["none"],
      potentialConsequences: [],
    },
  ],
  requiresSearch: false,
  requiresClarification: false,
  rationale: "Eating is the terminal intent and the asserted source is harmless texture.",
};

const gumPlan: WorldActionPlannerResult = {
  primaryKind: "consume",
  requiresClarification: false,
  rationale: "The mundane asserted gum can support the immediate consume action.",
  plan: {
    originalCommand: "I eat gum off a light pole.",
    exclusivePhysical: false,
    steps: [
      {
        order: 1,
        kind: "consume",
        description: "Peel off and chew the old gum.",
        intentPayload: {
          rawText: "I eat gum off a light pole.",
          requestedConcept: "old chewing gum",
          sourceMode: "ephemeral_environmental",
          environmentalAffordances: [
            { concept: "old chewing gum", role: "object", status: "plausible_ephemeral" },
            {
              concept: "generic municipal light pole",
              role: "source",
              status: "plausible_ephemeral",
            },
          ],
        },
        referencedEntities: [{ entityId: actorId, role: "actor", expectedVersion: 2 }],
      },
    ],
    dependencies: [],
  },
};

describe("persistent world planner", () => {
  it("preserves combat as terminal intent while travel remains a prerequisite", () => {
    const validated = validatePersistentWorldPlan(result, request, combatAssessment);
    expect(validated.primaryKind).toBe("combat");
    expect(validated.plan?.steps[0]?.kind).toBe("move");
    expect(validated.plan?.dependencies[0]?.dependencyType).toBe("after_arrival");
    expect(validated.plan?.steps[1]?.kind).toBe("combat");
  });

  it("allows a known area ID supplied as a player-visible fact value", () => {
    const roomId = "10000000-0000-4000-8000-000000000004";
    const command = "I look around the room.";
    const observationRequest: WorldActionPlannerRequest = {
      command,
      actorId,
      playerKnownFacts: [
        { entityId: actorId, claim: "entity.location", value: roomId },
        { entityId: actorId, claim: "entity.version", value: 2 },
      ],
      resolvedEntityIds: [],
      activePlanSummary: null,
      enabledHandlers: ["search"],
      gameMasterContext: gameMasterContext(command, roomId),
    };
    const observationAssessment: AffordanceAssessment = {
      terminalIntent: "search",
      premises: [],
      requiresSearch: true,
      requiresClarification: false,
      rationale: "The player is observing the current location.",
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

    expect(
      validatePersistentWorldPlan(
        observationResult,
        observationRequest,
        observationAssessment,
      ).plan?.steps[0],
    ).toMatchObject({
      kind: "search",
      intentPayload: { areaId: roomId },
    });
  });

  it("accepts ephemeral gum as consume without a search step", () => {
    const validated = validatePersistentWorldPlan(gumPlan, gumRequest(), gumAssessment);
    expect(validated.primaryKind).toBe("consume");
    expect(validated.plan?.steps).toHaveLength(1);
    expect(validated.plan?.steps[0]).toMatchObject({
      kind: "consume",
      intentPayload: { sourceMode: "ephemeral_environmental" },
    });
  });

  it("rejects routing the gum command to search", () => {
    expect(() =>
      validatePersistentWorldPlan(
        { ...gumPlan, primaryKind: "search" },
        gumRequest(),
        gumAssessment,
      ),
    ).toThrow(/terminal intent/i);
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
        combatAssessment,
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
        combatAssessment,
      ),
    ).toThrow(/absent from player-visible planner context/i);
  });

  it("includes the constitution, history, and affordance assessment in the prompt", () => {
    const prompt = buildPersistentWorldPlannerPrompt(gumRequest(), gumAssessment);
    expect(prompt).toContain("NOCTURNE GAME CONSTITUTION");
    expect(prompt).toContain("AFFORDANCE ASSESSMENT");
    expect(prompt).toContain("CURRENT SCENE");
    expect(prompt).toContain("RECENT TURNS");
    expect(prompt).toContain("The oatmeal was bland but filling");
    expect(prompt).toContain("ephemeral_environmental");
    expect(prompt).toContain("terminal intent");
  });

  it("uses a conservative assessment when the affordance provider fails", async () => {
    const generateStructured = vi
      .fn()
      .mockRejectedValueOnce(new Error("affordance provider failure"))
      .mockResolvedValueOnce({
        data: gumPlan,
        requestedModel: "test-model",
        actualModel: "test-model",
      });

    const planned = await planPersistentWorldAction({ generateStructured }, gumRequest());

    expect(generateStructured).toHaveBeenCalledTimes(2);
    expect(planned.affordanceSource).toBe("conservative_fallback");
    expect(planned.affordanceAssessment.terminalIntent).toBe("consume");
    expect(planned.data.primaryKind).toBe("consume");
  });
});
