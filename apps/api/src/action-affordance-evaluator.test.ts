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
    ],
    playerKnownFacts: (input.facts ?? []).map((claim, index) => ({
      factId: `fact-${index}`,
      entityId: input.actorId,
      claim,
      value: true,
      visibility: "player_known" as const,
      provenance: { kind: "character_state" as const, sourceId: input.actorId },
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
});
