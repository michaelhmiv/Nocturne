import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deriveSemanticActionFrame, isRoutineSelfDirectedAction } from "./semantic-action-frame.js";

function context(actorId: string, targetId?: string) {
  return {
    compilationId: randomUUID(),
    policyVersion: "test-v1",
    worldId: randomUUID(),
    shardId: randomUUID(),
    viewpointId: actorId,
    commandExcerpt: "test",
    entities: [
      {
        entityId: actorId,
        definitionId: "actor",
        name: "Tester",
        definitionType: "character",
        locationId: null,
        condition: 100,
        lifecycleStatus: "active",
        version: 1,
        visibility: "player_known" as const,
        relevanceScore: 100,
        inclusionReasons: ["actor" as const],
      },
      ...(targetId
        ? [
            {
              entityId: targetId,
              definitionId: "target",
              name: "Target",
              definitionType: "npc",
              locationId: null,
              condition: 100,
              lifecycleStatus: "active",
              version: 1,
              visibility: "player_known" as const,
              relevanceScore: 80,
              inclusionReasons: ["same_location" as const],
            },
          ]
        : []),
    ],
    playerKnownFacts: [],
    authoritativeHiddenFacts: [],
    omittedCandidateCount: 0,
    estimatedTokens: 0,
  };
}

describe("semantic action frame", () => {
  it("treats one push-up as a trivial self-directed action", () => {
    const actorId = randomUUID();
    const frame = deriveSemanticActionFrame({
      kind: "interact",
      actorId,
      rawText: "Do one push up",
      payload: { rawText: "Do one push up" },
      context: context(actorId),
    });
    expect(frame.actionType).toBe("exercise");
    expect(frame.quantity).toBe(1);
    expect(frame.targetIds).toEqual([]);
    expect(frame.properties.selfDirected).toBe(true);
    expect(frame.properties.opposed).toBe(false);
    expect(frame.demands.physicalEffort).toBeLessThanOrEqual(2);
    expect(isRoutineSelfDirectedAction(frame)).toBe(true);
  });

  it("does not treat an attack on another entity as routine", () => {
    const actorId = randomUUID();
    const targetId = randomUUID();
    const frame = deriveSemanticActionFrame({
      kind: "combat",
      actorId,
      rawText: "Punch the guard",
      payload: { rawText: "Punch the guard", targetId },
      resolvedReferences: { targetId },
      context: context(actorId, targetId),
    });
    expect(frame.targetIds).toEqual([targetId]);
    expect(frame.properties.opposed).toBe(true);
    expect(frame.properties.selfDirected).toBe(false);
    expect(isRoutineSelfDirectedAction(frame)).toBe(false);
  });

  it("keeps demanding exercise out of automatic routine handling", () => {
    const actorId = randomUUID();
    const frame = deriveSemanticActionFrame({
      kind: "interact",
      actorId,
      rawText: "Do 100 push-ups until failure",
      payload: { rawText: "Do 100 push-ups until failure" },
      context: context(actorId),
    });
    expect(frame.quantity).toBe(100);
    expect(frame.demands.physicalEffort).toBeGreaterThan(2);
    expect(isRoutineSelfDirectedAction(frame)).toBe(false);
  });

  it("preserves explicit possession claims even when no UUID resolves", () => {
    const actorId = randomUUID();
    const armed = deriveSemanticActionFrame({
      kind: "interact",
      actorId,
      rawText: "I run around the room with knives.",
      payload: {},
      context: context(actorId),
    });
    const inventory = deriveSemanticActionFrame({
      kind: "interact",
      actorId,
      rawText: "I eat the sandwich from my inventory.",
      payload: {},
      context: context(actorId),
    });
    expect(armed.assumptions).toContain("requires_possession:knives");
    expect(armed.demands.danger).toBeGreaterThanOrEqual(5);
    expect(inventory.assumptions).toContain("requires_possession:sandwich");
  });

  it("classifies deliberate harmful contact with the actor's body as dangerous", () => {
    const actorId = randomUUID();
    const frame = deriveSemanticActionFrame({
      kind: "interact",
      actorId,
      rawText: "I deliberately strike my forehead against the doorframe once.",
      payload: {},
      context: context(actorId),
    });
    expect(frame.properties.selfDirected).toBe(true);
    expect(frame.demands.danger).toBeGreaterThanOrEqual(5);
    expect(isRoutineSelfDirectedAction(frame)).toBe(false);
  });

  it("accepts minimal legacy test context without an entity collection", () => {
    const actorId = randomUUID();
    const frame = deriveSemanticActionFrame({
      kind: "consume",
      actorId,
      rawText: "Drink water",
      payload: { rawText: "Drink water" },
      context: {} as never,
    });
    expect(frame.actorId).toBe(actorId);
    expect(frame.targetIds).toEqual([]);
  });
});
