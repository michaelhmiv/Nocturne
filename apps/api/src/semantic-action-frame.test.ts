import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  deriveSemanticActionFrame,
  hasExplicitPossessionRequirement,
  isCurrentAreaSearchCommand,
  isRoutineSelfDirectedAction,
} from "./semantic-action-frame.js";
import { adjudicateActionResolution } from "./resolution-mode-adjudicator.js";

function context(actorId: string, targetId?: string, actorLocation: string | null = null) {
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
        locationId: actorLocation,
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
              locationId: actorLocation,
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
    expect(frame.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "target",
          resolution: "resolved_entity",
          resolvedEntityId: targetId,
        }),
      ]),
    );
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
    expect(armed.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          claimType: "possession",
          normalizedValue: "knives",
          required: true,
        }),
      ]),
    );
    expect(armed.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          relationship: "possessed",
          resolution: "unresolved",
          allowClarification: false,
        }),
      ]),
    );
    expect(armed.demands.danger).toBeGreaterThanOrEqual(5);
    expect(inventory.assumptions).toContain("requires_possession:sandwich");
    expect(inventory.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ claimType: "possession", normalizedValue: "sandwich" }),
      ]),
    );
  });

  it("recognizes plain possessive objects without turning locations into inventory", () => {
    const actorId = randomUUID();
    const sandwich = deriveSemanticActionFrame({
      kind: "consume",
      actorId,
      rawText: "Eat my sandwich.",
      payload: {},
      context: context(actorId),
    });
    const pistol = deriveSemanticActionFrame({
      kind: "interact",
      actorId,
      rawText: "Fire my pistol into the apartment wall.",
      payload: {},
      context: context(actorId),
    });
    const knife = deriveSemanticActionFrame({
      kind: "interact",
      actorId,
      rawText: "Cut it with my knife.",
      payload: {},
      context: context(actorId),
    });
    const currentUnit = deriveSemanticActionFrame({
      kind: "interact",
      actorId,
      rawText: "Look around my current unit and check the room carefully.",
      payload: {},
      context: context(actorId, undefined, randomUUID()),
    });

    expect(sandwich.assumptions).toContain("requires_possession:sandwich");
    expect(pistol.assumptions).toContain("requires_possession:pistol");
    expect(knife.assumptions).toContain("requires_possession:knife");
    expect(currentUnit.assumptions).not.toContain("requires_possession:current unit");
    expect(currentUnit.claims.some((claim) => claim.claimType === "possession")).toBe(false);
    expect(hasExplicitPossessionRequirement("Cut it with my knife.")).toBe(true);
    expect(
      hasExplicitPossessionRequirement("Look around my current unit and check the room carefully."),
    ).toBe(false);
    expect(
      isCurrentAreaSearchCommand("Look around my current unit and check the room carefully."),
    ).toBe(true);
  });

  it("classifies actor anatomy as intrinsic rather than inventory", () => {
    const actorId = randomUUID();
    const frame = deriveSemanticActionFrame({
      kind: "combat",
      actorId,
      rawText: "I strike the wall with my bare fist.",
      payload: {},
      context: context(actorId),
    });
    expect(frame.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ claimType: "anatomy", normalizedValue: "fist" }),
      ]),
    );
    expect(frame.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "anatomy",
          relationship: "intrinsic",
          resolution: "resolved_intrinsic",
        }),
      ]),
    );
    expect(frame.claims?.some((claim) => claim.claimType === "possession")).toBe(false);
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
    expect(frame.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ claimType: "anatomy", normalizedValue: "forehead" }),
      ]),
    );
    expect(isRoutineSelfDirectedAction(frame)).toBe(false);
  });

  it("preserves explicit real-time duration as a typed claim", () => {
    const actorId = randomUUID();
    const frame = deriveSemanticActionFrame({
      kind: "interact",
      actorId,
      rawText: "Exercise for two minutes",
      payload: { durationSeconds: 120 },
      context: context(actorId),
    });
    expect(frame.durationSeconds).toBe(120);
    expect(frame.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ claimType: "duration", durationSeconds: 120 }),
      ]),
    );
  });

  it.each([
    ["Exercise continuously for exactly two minutes.", 120],
    ["Do push-ups for two minutes", 120],
    ["Stretch over the next three minutes", 180],
    ["Work for 15 minutes", 900],
    ["Wait for twelve seconds", 12],
  ] as [string, number][])("schedules %s", (rawText, seconds) => {
    const actorId = randomUUID();
    const frame = deriveSemanticActionFrame({
      kind: "interact",
      actorId,
      rawText,
      payload: { rawText, actionType: "exercise" },
      context: context(actorId),
    });
    expect(frame.durationSeconds).toBe(seconds);
    expect(frame.properties.continuous).toBe(true);
    expect(frame.claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ claimType: "duration", durationSeconds: seconds }),
      ]),
    );
    expect(isRoutineSelfDirectedAction(frame)).toBe(false);
    expect(adjudicateActionResolution(frame).mode).toBe("timed_task");
  });

  it("does not treat a zero-duration instruction as a completed interval", () => {
    const actorId = randomUUID();
    const frame = deriveSemanticActionFrame({
      kind: "interact",
      actorId,
      rawText: "Exercise for 0 minutes",
      payload: {},
      context: context(actorId),
    });
    expect(frame.durationSeconds).toBeUndefined();
    expect(frame.claims.some((claim) => claim.claimType === "duration")).toBe(false);
  });

  it("resolves current-location deixis to the actor's authoritative location", () => {
    const actorId = randomUUID();
    const locationId = randomUUID();
    const frame = deriveSemanticActionFrame({
      kind: "question",
      actorId,
      rawText: "What is in this apartment?",
      payload: {},
      context: context(actorId, undefined, locationId),
    });
    expect(frame.locationId).toBe(locationId);
    expect(frame.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          referenceKey: "current_location",
          role: "location",
          relationship: "current_location",
          resolution: "resolved_entity",
          resolvedEntityId: locationId,
        }),
      ]),
    );
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
