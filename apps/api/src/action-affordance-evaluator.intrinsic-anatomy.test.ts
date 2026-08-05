import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { RelevanceCompiledContext, SemanticActionFrame } from "@nocturne/contracts";
import { evaluateActionAffordance } from "./action-affordance-evaluator.js";

function context(actorId: string): RelevanceCompiledContext {
  const locationId = randomUUID();
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
        locationId,
        condition: 100,
        lifecycleStatus: "active",
        version: 1,
        visibility: "player_known",
        relevanceScore: 100,
        inclusionReasons: ["actor"],
      },
    ],
    playerKnownFacts: [],
    authoritativeHiddenFacts: [],
    omittedCandidateCount: 0,
    estimatedTokens: 0,
  };
}

function frame(actorId: string, possession: string): SemanticActionFrame {
  return {
    kind: "interact",
    actionType: "touch",
    objective: `Touch with ${possession}`,
    actorId,
    targetIds: [],
    objectIds: [],
    toolIds: [],
    references: [
      {
        referenceKey: "body_part",
        originalText: possession,
        normalizedText: possession,
        role: "tool",
        required: true,
        relationship: "possessed",
        resolution: "unresolved",
        candidateEntityIds: [],
        allowClarification: false,
      },
    ],
    claims: [
      {
        claimKey: "body_part",
        claimType: "possession",
        sourceText: possession,
        normalizedValue: possession,
        required: true,
        referenceKey: "body_part",
      },
    ],
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
      physicalEffort: 0,
      technicalComplexity: 0,
      precision: 0,
      danger: 0,
      timePressure: 0,
    },
    assumptions: [],
    ambiguities: [],
  };
}

describe("intrinsic anatomy possession fallback", () => {
  it.each([
    "bare fist",
    "open right hand",
    "right fingertips",
    "left forearm",
    "bare palm",
    "right wrist",
  ])("does not require inventory ownership for %s", (bodyPart) => {
    const actorId = randomUUID();
    expect(evaluateActionAffordance(frame(actorId, bodyPart), context(actorId)).status).toBe(
      "feasible",
    );
  });

  it("does not exempt a mixed anatomy-and-item phrase", () => {
    const actorId = randomUUID();
    const evaluation = evaluateActionAffordance(frame(actorId, "hand grenade"), context(actorId));
    expect(evaluation.status).toBe("blocked");
    expect(evaluation.missingRequirements).toContain("possess hand grenade");
  });
});
