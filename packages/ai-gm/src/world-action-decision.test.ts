import { describe, expect, it } from "vitest";
import type { EntityReferenceCandidate, RelevanceCompiledContext } from "@nocturne/contracts";
import {
  buildFastSingleStepPlan,
  decideWorldActionFastPath,
  shortlistDecisionCandidates,
} from "./world-action-decision.js";

const actorId = "00000000-0000-4000-8000-000000000001";
const doorId = "00000000-0000-4000-8000-000000000002";
const guardId = "00000000-0000-4000-8000-000000000003";
const homeId = "00000000-0000-4000-8000-000000000004";
const bankId = "00000000-0000-4000-8000-000000000005";

function candidate(
  input: Partial<EntityReferenceCandidate> & { entityId: string; displayName: string },
) {
  return {
    entityId: input.entityId,
    displayName: input.displayName,
    definitionType: input.definitionType || "item",
    lifecycleStatus: "active",
    locationId: null,
    aliases: input.aliases || [input.displayName],
    relationshipLabels: input.relationshipLabels || [],
    relevanceScore: input.relevanceScore ?? 100,
    accessible: input.accessible ?? true,
    present: input.present ?? true,
    supportingFactIds: input.supportingFactIds || ["fact-1"],
  } satisfies EntityReferenceCandidate;
}

describe("Jev world-action fast path", () => {
  it("prioritizes lexical references before generic relevance", () => {
    const shortlisted = shortlistDecisionCandidates("open the red door", [
      candidate({ entityId: guardId, displayName: "Guard", relevanceScore: 999 }),
      candidate({ entityId: doorId, displayName: "Red Door", relevanceScore: 10 }),
    ]);
    expect(shortlisted[0]?.entityId).toBe(doorId);
  });

  it("routes one clear interaction and resolves supplied candidates", async () => {
    const client = {
      decide: async () => ({
        answers: {
          primary_kind: { type: "choice" as const, choice: "interact", confidence: 0.96 },
          action_type: { type: "choice" as const, choice: "interact", confidence: 0.97 },
          requires_clarification: { type: "noul" as const, noul: 0.03 },
          requires_multi_step: { type: "noul" as const, noul: 0.05 },
          role_0: {
            type: "choice" as const,
            choice: "target",
            confidence: 0.97,
            probabilities: { target: 0.97, none: 0.03 },
          },
        },
        requestedModel: "~typesafe/jev-latest",
        actualModel: "typesafe/jev-1.13-20260917",
        provider: "openrouter" as const,
        latencyMs: 210,
      }),
    };

    const result = await decideWorldActionFastPath(client as never, {
      command: "open the red door",
      actorId,
      enabledHandlers: ["interact", "dialogue"],
      recentPlayerSafeText: [],
      candidates: [candidate({ entityId: doorId, displayName: "Red Door" })],
    });

    expect(result.kind).toBe("interact");
    expect(result.fastPathEligible).toBe(true);
    expect(result.selectedEntityIds).toEqual([doorId]);
    expect(result.selectedEntityRoles).toEqual({ [doorId]: "target" });
    expect(result.interpretation.mentions[0]?.selectedEntityId).toBe(doorId);
  });

  it("does not turn a high clarification score without references into a forced wait", async () => {
    const client = {
      decide: async () => ({
        answers: {
          action_type: { type: "choice" as const, choice: "interact", confidence: 0.99 },
          requires_clarification: { type: "noul" as const, noul: 0.99 },
          requires_multi_step: { type: "noul" as const, noul: 0.01 },
        },
        requestedModel: "~typesafe/jev-latest",
        actualModel: "typesafe/jev-1.13",
        provider: "openrouter" as const,
        latencyMs: 90,
      }),
    };

    const result = await decideWorldActionFastPath(client as never, {
      command: "check the room",
      actorId,
      enabledHandlers: ["interact"],
      recentPlayerSafeText: [],
      candidates: [],
    });

    expect(result.interpretation.mentions).toEqual([]);
    expect(result.fastPathEligible).toBe(true);
    expect(result.fallbackReasons).toEqual([]);
  });

  it("keeps known-entity observation distinct from discovery search", async () => {
    const observationClient = {
      decide: async () => ({
        answers: {
          action_type: { type: "choice" as const, choice: "observe", confidence: 0.99 },
          requires_clarification: { type: "noul" as const, noul: 0.01 },
          requires_multi_step: { type: "noul" as const, noul: 0.01 },
          role_0: {
            type: "choice" as const,
            choice: "target",
            confidence: 0.99,
            probabilities: { target: 0.99, none: 0.01 },
          },
        },
        requestedModel: "~typesafe/jev-latest",
        actualModel: "typesafe/jev-1.13-20260917",
        provider: "openrouter" as const,
        latencyMs: 120,
      }),
    };
    const observed = await decideWorldActionFastPath(observationClient as never, {
      command: "Observe the red door carefully.",
      actorId,
      enabledHandlers: ["interact", "search"],
      recentPlayerSafeText: [],
      candidates: [candidate({ entityId: doorId, displayName: "Red Door" })],
    });
    expect(observed.actionType).toBe("observe");
    expect(observed.kind).toBe("interact");
    expect(observed.selectedEntityIds).toEqual([doorId]);

    const searchClient = {
      decide: async () => ({
        answers: {
          action_type: { type: "choice" as const, choice: "search", confidence: 0.99 },
          requires_clarification: { type: "noul" as const, noul: 0.01 },
          requires_multi_step: { type: "noul" as const, noul: 0.01 },
        },
        requestedModel: "~typesafe/jev-latest",
        actualModel: "typesafe/jev-1.13-20260917",
        provider: "openrouter" as const,
        latencyMs: 120,
      }),
    };
    const searched = await decideWorldActionFastPath(searchClient as never, {
      command: "Search the room for a hidden crowbar.",
      actorId,
      enabledHandlers: ["interact", "search"],
      recentPlayerSafeText: [],
      candidates: [],
    });
    expect(searched.actionType).toBe("search");
    expect(searched.kind).toBe("search");
  });

  it("falls back for compound actions instead of forcing a one-step plan", async () => {
    const client = {
      decide: async () => ({
        answers: {
          primary_kind: { type: "choice" as const, choice: "combat", confidence: 0.94 },
          action_type: { type: "choice" as const, choice: "attack", confidence: 0.96 },
          requires_clarification: { type: "noul" as const, noul: 0.02 },
          requires_multi_step: { type: "noul" as const, noul: 0.92 },
        },
        requestedModel: "~typesafe/jev-latest",
        actualModel: "typesafe/jev-1.13",
        provider: "openrouter" as const,
        latencyMs: 220,
      }),
    };
    const result = await decideWorldActionFastPath(client as never, {
      command: "drive downtown, find the guard, then punch him",
      actorId,
      enabledHandlers: ["move", "combat"],
      recentPlayerSafeText: [],
      candidates: [],
    });
    expect(result.fastPathEligible).toBe(false);
    expect(result.fallbackReasons).toContain("multi_step");
  });

  it("resolves a high-confidence remote location for travel without treating distance as an invalid reference", async () => {
    const client = {
      decide: async () => ({
        answers: {
          primary_kind: { type: "choice" as const, choice: "move", confidence: 0.98 },
          action_type: { type: "choice" as const, choice: "move", confidence: 0.99 },
          requires_clarification: { type: "noul" as const, noul: 0.01 },
          requires_multi_step: { type: "noul" as const, noul: 0.03 },
          role_0: {
            type: "choice" as const,
            choice: "location",
            confidence: 0.98,
            probabilities: { location: 0.98, none: 0.02 },
          },
        },
        requestedModel: "~typesafe/jev-latest",
        actualModel: "typesafe/jev-1.13",
        provider: "openrouter" as const,
        latencyMs: 205,
      }),
    };
    const result = await decideWorldActionFastPath(client as never, {
      command: "go to the bank",
      actorId,
      enabledHandlers: ["move", "interact"],
      recentPlayerSafeText: [],
      candidates: [
        candidate({
          entityId: bankId,
          displayName: "First National Bank",
          aliases: ["bank"],
          definitionType: "location",
          accessible: false,
          present: false,
        }),
      ],
    });

    expect(result.kind).toBe("move");
    expect(result.fastPathEligible).toBe(true);
    expect(result.selectedEntityIds).toEqual([bankId]);
    expect(result.selectedEntityRoles).toEqual({ [bankId]: "location" });
  });

  it("compiles a Jev give command with resource and recipient roles", async () => {
    const wrenchId = "00000000-0000-4000-8000-000000000006";
    const mechanicId = "00000000-0000-4000-8000-000000000007";
    const client = {
      decide: async (request: { state: unknown }) => {
        const state = request.state as {
          candidates?: Array<{ id?: string; type?: string }>;
        };
        const answers: Record<string, unknown> = {
          action_type: { type: "choice" as const, choice: "give", confidence: 0.99 },
          requires_clarification: { type: "noul" as const, noul: 0.01 },
          requires_multi_step: { type: "noul" as const, noul: 0.01 },
        };
        for (const [index, candidateValue] of (state.candidates || []).entries()) {
          const role = candidateValue.id === wrenchId ? "resource" : "target";
          answers[`role_${index}`] = {
            type: "choice" as const,
            choice: role,
            confidence: 0.98,
            probabilities: { [role]: 0.98, none: 0.02 },
          };
        }
        return {
          answers,
          requestedModel: "~typesafe/jev-latest",
          actualModel: "typesafe/jev-1.13",
          provider: "openrouter" as const,
          latencyMs: 180,
        };
      },
    };

    const decision = await decideWorldActionFastPath(client as never, {
      command: "Give the wrench to the mechanic.",
      actorId,
      enabledHandlers: ["transfer"],
      recentPlayerSafeText: [],
      candidates: [
        candidate({ entityId: wrenchId, displayName: "Wrench", definitionType: "item" }),
        candidate({ entityId: mechanicId, displayName: "Mechanic", definitionType: "character" }),
      ],
    });

    expect(decision.actionType).toBe("give");
    expect(decision.kind).toBe("transfer");
    expect(decision.selectedEntityRoles).toEqual({
      [wrenchId]: "resource",
      [mechanicId]: "target",
    });

    const context = {
      entities: [
        { entityId: actorId, version: 1, definitionType: "character" },
        { entityId: wrenchId, version: 2, definitionType: "item" },
        { entityId: mechanicId, version: 3, definitionType: "character" },
      ],
    } as unknown as RelevanceCompiledContext;
    const plan = buildFastSingleStepPlan({
      command: "Give the wrench to the mechanic.",
      actorId,
      kind: decision.kind,
      actionType: decision.actionType,
      selectedEntityIds: decision.selectedEntityIds,
      selectedEntityRoles: decision.selectedEntityRoles,
      context,
    });

    expect(plan.steps[0]?.intentPayload).toEqual({
      rawText: "Give the wrench to the mechanic.",
      actionType: "give",
      targetIds: [mechanicId],
      resourceIds: [wrenchId],
    });
  });

  it("compiles known-location travel directly into a movement payload", () => {
    const context = {
      entities: [
        { entityId: actorId, version: 4, definitionType: "character", locationId: homeId },
        { entityId: bankId, version: 9, definitionType: "location", locationId: null },
      ],
    } as unknown as RelevanceCompiledContext;
    const plan = buildFastSingleStepPlan({
      command: "go to the bank",
      actorId,
      kind: "move",
      actionType: "move",
      selectedEntityIds: [bankId],
      selectedEntityRoles: { [bankId]: "location" },
      context,
    });

    expect(plan.steps[0]?.intentPayload).toEqual({
      rawText: "go to the bank",
      actionType: "move",
      locationId: bankId,
      destinationId: bankId,
    });
    expect(plan.steps[0]?.referencedEntities[1]?.role).toBe("location");
  });

  it("compiles an explicit simple search in the actor's current area", () => {
    const context = {
      entities: [
        { entityId: actorId, version: 4, definitionType: "character", locationId: homeId },
        { entityId: homeId, version: 2, definitionType: "residence", locationId: null },
      ],
    } as unknown as RelevanceCompiledContext;
    const plan = buildFastSingleStepPlan({
      command: "look around for a crowbar",
      actorId,
      kind: "search",
      actionType: "search",
      selectedEntityIds: [],
      context,
    });

    expect(plan.steps[0]?.intentPayload).toEqual({
      rawText: "look around for a crowbar",
      actionType: "search",
      areaId: homeId,
      requestedConcept: "crowbar",
    });
  });

  it("can compile an impossible movement as a semantic failure step", () => {
    const context = {
      entities: [{ entityId: actorId, version: 4, definitionType: "character" }],
    } as unknown as RelevanceCompiledContext;
    const plan = buildFastSingleStepPlan({
      command: "Walk through the solid wall.",
      actorId,
      kind: "move",
      planKind: "interact",
      actionType: "move",
      selectedEntityIds: [],
      context,
    });

    expect(plan.steps[0]?.kind).toBe("interact");
    expect(plan.steps[0]?.intentPayload).toEqual({
      rawText: "Walk through the solid wall.",
      actionType: "move",
    });
  });

  it("builds a deterministic one-step persistent plan", () => {
    const context = {
      entities: [
        {
          entityId: actorId,
          version: 4,
        },
        {
          entityId: doorId,
          version: 7,
        },
      ],
    } as unknown as RelevanceCompiledContext;
    const plan = buildFastSingleStepPlan({
      command: "open the red door",
      actorId,
      kind: "interact",
      actionType: "interact",
      selectedEntityIds: [doorId],
      selectedEntityRoles: { [doorId]: "target" },
      context,
    });

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.kind).toBe("interact");
    expect(plan.steps[0]?.intentPayload).toEqual({
      rawText: "open the red door",
      actionType: "interact",
      targetIds: [doorId],
    });
    expect(plan.steps[0]?.referencedEntities).toEqual([
      { entityId: actorId, role: "actor", expectedVersion: 4 },
      { entityId: doorId, role: "target", expectedVersion: 7 },
    ]);
  });
});
