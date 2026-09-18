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
          ref_0: { type: "noul" as const, noul: 0.97 },
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
    expect(result.interpretation.mentions[0]?.selectedEntityId).toBe(doorId);
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
          ref_0: { type: "noul" as const, noul: 0.98 },
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
      context,
    });

    expect(plan.steps[0]?.intentPayload).toEqual({
      rawText: "go to the bank",
      actionType: "move",
      destinationId: bankId,
    });
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
      context,
    });

    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]?.kind).toBe("interact");
    expect(plan.steps[0]?.intentPayload).toEqual({
      rawText: "open the red door",
      actionType: "interact",
    });
    expect(plan.steps[0]?.referencedEntities).toEqual([
      { entityId: actorId, role: "actor", expectedVersion: 4 },
      { entityId: doorId, role: "target", expectedVersion: 7 },
    ]);
  });
});
