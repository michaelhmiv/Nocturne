import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { RelevanceCompiledContext, SemanticActionFrame } from "@nocturne/contracts";
import { evaluateActionAffordance } from "./action-affordance-evaluator.js";

function context(input: {
  actorId: string;
  actorLocation?: string | null;
  actorCondition?: number;
  targetId?: string;
  targetLocation?: string | null;
  ownedItemName?: string;
  facts?: string[];
}): RelevanceCompiledContext {
  const actorLocation = input.actorLocation === undefined ? randomUUID() : input.actorLocation;
  return {
    compilationId: randomUUID(),
    policyVersion: "test-v1",
    worldId: randomUUID(),
    shardId: randomUUID(),
    viewpointId: input.actorId,
    commandExcerpt: "test",
    entities: [
      {
        entityId: input.actorId,
        definitionId: "actor",
        name: "Tester",
        definitionType: "character",
        locationId: actorLocation,
        condition: input.actorCondition ?? 100,
        lifecycleStatus: "active",
        version: 1,
        visibility: "player_known",
        relevanceScore: 100,
        inclusionReasons: ["actor"],
      },
      ...(input.targetId
        ? [
            {
              entityId: input.targetId,
              definitionId: "target",
              name: "Cabinet",
              definitionType: "object",
              locationId: input.targetLocation === undefined ? actorLocation : input.targetLocation,
              condition: 100,
              lifecycleStatus: "active",
              version: 1,
              visibility: "player_known" as const,
              relevanceScore: 80,
              inclusionReasons: ["explicit_reference" as const],
            },
          ]
        : []),
      ...(input.ownedItemName
        ? [
            {
              entityId: randomUUID(),
              definitionId: "owned-item",
              name: input.ownedItemName,
              definitionType: "item",
              locationId: actorLocation,
              condition: 100,
              lifecycleStatus: "active",
              version: 1,
              visibility: "player_known" as const,
              relevanceScore: 90,
              inclusionReasons: ["owned" as const],
            },
          ]
        : []),
    ],
    playerKnownFacts: (input.facts ?? []).map((claim, index) => ({
      factId: `fact-${index}`,
      entityId: input.actorId,
      claim,
      value: true,
      visibility: "player_known" as const,
      provenance: {
        kind: "character_state" as const,
        sourceId: input.actorId,
      },
      relevanceScore: 100 - index,
      inclusionReasons: ["safety_critical" as const],
    })),
    authoritativeHiddenFacts: [],
    omittedCandidateCount: 0,
    estimatedTokens: 0,
  };
}

function frame(actorId: string, overrides: Partial<SemanticActionFrame> = {}): SemanticActionFrame {
  return {
    kind: "interact",
    actionType: "exercise",
    objective: "Do one push-up",
    actorId,
    targetIds: [],
    objectIds: [],
    toolIds: [],
    references: [],
    claims: [],
    properties: {
      selfDirected: true,
      opposed: false,
      destructive: false,
      illegal: false,
      social: false,
      movement: false,
      continuous: false,
    },
    demands: {
      physicalEffort: 2,
      technicalComplexity: 0,
      precision: 0,
      danger: 0,
      timePressure: 0,
    },
    assumptions: [],
    ambiguities: [],
    ...overrides,
  };
}

describe("action affordance evaluator", () => {
  it("allows an ordinary self-directed action", () => {
    const actorId = randomUUID();
    expect(evaluateActionAffordance(frame(actorId), context({ actorId })).status).toBe("feasible");
  });

  it("blocks an incapacitated actor", () => {
    const actorId = randomUUID();
    const evaluation = evaluateActionAffordance(
      frame(actorId),
      context({ actorId, facts: ["actor is unconscious"] }),
    );
    expect(evaluation.status).toBe("blocked");
    expect(evaluation.rationale).toMatch(/incapacitating/i);
  });

  it("blocks physical interaction with an object in another location", () => {
    const actorId = randomUUID();
    const targetId = randomUUID();
    const base = frame(actorId);
    const evaluation = evaluateActionAffordance(
      frame(actorId, {
        actionType: "open",
        objective: "Open the cabinet",
        targetIds: [targetId],
        properties: { ...base.properties, selfDirected: false },
      }),
      context({
        actorId,
        actorLocation: randomUUID(),
        targetId,
        targetLocation: randomUUID(),
      }),
    );
    expect(evaluation.status).toBe("blocked");
    expect(evaluation.missingRequirements[0]).toMatch(/reach/i);
  });

  it("requires clarification for a referenced entity omitted from context", () => {
    const actorId = randomUUID();
    const targetId = randomUUID();
    const base = frame(actorId);
    const evaluation = evaluateActionAffordance(
      frame(actorId, {
        targetIds: [targetId],
        properties: { ...base.properties, selfDirected: false },
      }),
      context({ actorId }),
    );
    expect(evaluation.status).toBe("clarification_required");
  });

  it("blocks a typed possession claim when no controlled item matches", () => {
    const actorId = randomUUID();
    const base = frame(actorId);
    const evaluation = evaluateActionAffordance(
      frame(actorId, {
        objective: "Run around the room with knives",
        claims: [
          {
            claimKey: "possession_knives",
            claimType: "possession",
            sourceText: "knives",
            normalizedValue: "knives",
            required: true,
            referenceKey: "possession_knives",
          },
        ],
        references: [
          {
            referenceKey: "possession_knives",
            originalText: "knives",
            normalizedText: "knives",
            role: "tool",
            required: true,
            relationship: "possessed",
            resolution: "unresolved",
            candidateEntityIds: [],
            allowClarification: false,
          },
        ],
        properties: { ...base.properties, selfDirected: false },
        demands: { ...base.demands, danger: 5 },
      }),
      context({ actorId }),
    );
    expect(evaluation.status).toBe("blocked");
    expect(evaluation.missingRequirements).toContain("possess knives");
  });

  it("preserves legacy possession assumptions during migration", () => {
    const actorId = randomUUID();
    const base = frame(actorId);
    const evaluation = evaluateActionAffordance(
      frame(actorId, {
        objective: "Run around the room with knives",
        assumptions: ["requires_possession:knives"],
        properties: { ...base.properties, selfDirected: false },
        demands: { ...base.demands, danger: 5 },
      }),
      context({ actorId }),
    );
    expect(evaluation.status).toBe("blocked");
    expect(evaluation.missingRequirements).toContain("possess knives");
  });

  it("checks missing possession before secondary target ambiguity", () => {
    const actorId = randomUUID();
    const base = frame(actorId);
    const evaluation = evaluateActionAffordance(
      frame(actorId, {
        objective: "Carve an X into the wall with my knife",
        claims: [
          {
            claimKey: "possession_knife",
            claimType: "possession",
            sourceText: "my knife",
            normalizedValue: "knife",
            required: true,
            referenceKey: "possession_knife",
          },
        ],
        references: [
          {
            referenceKey: "possession_knife",
            originalText: "my knife",
            normalizedText: "knife",
            role: "tool",
            required: true,
            relationship: "possessed",
            resolution: "unresolved",
            candidateEntityIds: [],
            allowClarification: false,
          },
          {
            referenceKey: "target_wall",
            originalText: "the wall",
            normalizedText: "wall",
            role: "target",
            required: true,
            relationship: "visible",
            resolution: "ambiguous",
            candidateEntityIds: [randomUUID(), randomUUID()],
            allowClarification: true,
          },
        ],
        properties: { ...base.properties, selfDirected: false, destructive: true },
      }),
      context({ actorId }),
    );
    expect(evaluation.status).toBe("blocked");
    expect(evaluation.missingRequirements).toEqual(["possess knife"]);
  });

  it("accepts plural possession language when a matching owned item exists", () => {
    const actorId = randomUUID();
    const base = frame(actorId);
    const evaluation = evaluateActionAffordance(
      frame(actorId, {
        objective: "Hold the knives",
        claims: [
          {
            claimKey: "possession_knives",
            claimType: "possession",
            sourceText: "knives",
            normalizedValue: "knives",
            required: true,
          },
        ],
        properties: { ...base.properties, selfDirected: false },
      }),
      context({ actorId, ownedItemName: "Kitchen Knife" }),
    );
    expect(evaluation.status).toBe("feasible");
  });

  it("treats intrinsic anatomy as available without inventory", () => {
    const actorId = randomUUID();
    const base = frame(actorId);
    const evaluation = evaluateActionAffordance(
      frame(actorId, {
        objective: "Strike the wall with my bare fist",
        claims: [
          {
            claimKey: "anatomy_fist",
            claimType: "anatomy",
            sourceText: "bare fist",
            normalizedValue: "fist",
            required: true,
            referenceKey: "anatomy_fist",
          },
        ],
        references: [
          {
            referenceKey: "anatomy_fist",
            originalText: "bare fist",
            normalizedText: "fist",
            role: "anatomy",
            required: true,
            relationship: "intrinsic",
            resolution: "resolved_intrinsic",
            candidateEntityIds: [],
            allowClarification: false,
          },
        ],
        properties: { ...base.properties, selfDirected: false, destructive: true },
        demands: { ...base.demands, danger: 4 },
      }),
      context({ actorId }),
    );
    expect(evaluation.status).toBe("feasible");
  });

  it("surfaces deterministic warnings for destructive and dangerous actions", () => {
    const actorId = randomUUID();
    const base = frame(actorId);
    const evaluation = evaluateActionAffordance(
      frame(actorId, {
        objective: "Smash the window beside the live wire",
        properties: { ...base.properties, destructive: true },
        demands: { ...base.demands, danger: 6 },
      }),
      context({ actorId }),
    );
    expect(evaluation.status).toBe("feasible");
    expect(evaluation.warnings).toEqual(
      expect.arrayContaining([expect.stringMatching(/damage/i), expect.stringMatching(/danger/i)]),
    );
  });
});
