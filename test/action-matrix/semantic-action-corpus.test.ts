import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  RelevanceCompiledContext,
  SemanticActionFrame,
} from "@nocturne/contracts";
import { adjudicateActionResolution } from "../../apps/api/src/resolution-mode-adjudicator.js";
import { deriveSemanticActionFrame } from "../../apps/api/src/semantic-action-frame.js";
import {
  SEMANTIC_ACTION_CORPUS,
  type SemanticActionCorpusCase,
} from "./semantic-action-corpus.js";

function entity(input: {
  entityId: string;
  definitionType: string;
  name: string;
  locationId: string;
  inclusionReasons: RelevanceCompiledContext["entities"][number]["inclusionReasons"];
}) {
  return {
    entityId: input.entityId,
    definitionId: `${input.definitionType}-definition`,
    name: input.name,
    definitionType: input.definitionType,
    locationId: input.locationId,
    condition: 100,
    lifecycleStatus: "active",
    version: 1,
    visibility: "player_known" as const,
    relevanceScore: 90,
    inclusionReasons: input.inclusionReasons,
  };
}

function setup(testCase: SemanticActionCorpusCase) {
  const actorId = randomUUID();
  const locationId = randomUUID();
  const personId = randomUUID();
  const objectId = randomUUID();
  const toolId = randomUUID();
  const destinationId = randomUUID();
  const ids = { actorId, personId, objectId, toolId, destinationId, locationId };
  const payload: Record<string, unknown> = { rawText: testCase.prompt };
  const resolvedReferences: Record<string, unknown> = {};

  if (testCase.targetKey) {
    const selectedId = testCase.targetKey === "destinationId" ? destinationId : personId;
    payload[testCase.targetKey] = selectedId;
    resolvedReferences[testCase.targetKey] = selectedId;
  }
  if (testCase.objectKey) {
    payload[testCase.objectKey] = objectId;
    resolvedReferences[testCase.objectKey] = objectId;
  }
  if (testCase.toolKey) {
    payload[testCase.toolKey] = toolId;
    resolvedReferences[testCase.toolKey] = toolId;
  }

  const context: RelevanceCompiledContext = {
    compilationId: randomUUID(),
    policyVersion: "semantic-corpus-v1",
    worldId: randomUUID(),
    shardId: randomUUID(),
    viewpointId: actorId,
    commandExcerpt: testCase.prompt,
    entities: [
      entity({
        entityId: actorId,
        definitionType: "character",
        name: "Corpus Tester",
        locationId,
        inclusionReasons: ["actor"],
      }),
      entity({
        entityId: personId,
        definitionType: "npc",
        name: "Referenced Person",
        locationId,
        inclusionReasons: ["explicit_reference"],
      }),
      entity({
        entityId: objectId,
        definitionType: "object",
        name: "Referenced Object",
        locationId,
        inclusionReasons: ["explicit_reference", "possessed"],
      }),
      entity({
        entityId: toolId,
        definitionType: "tool",
        name: "Controlled Tool",
        locationId,
        inclusionReasons: ["explicit_reference", "controlled"],
      }),
      entity({
        entityId: destinationId,
        definitionType: "location",
        name: "Destination",
        locationId: destinationId,
        inclusionReasons: ["explicit_reference"],
      }),
    ],
    playerKnownFacts: [],
    authoritativeHiddenFacts: [],
    omittedCandidateCount: 0,
    estimatedTokens: 0,
  };

  const derived = deriveSemanticActionFrame({
    kind: testCase.kind,
    actorId,
    rawText: testCase.prompt,
    payload,
    resolvedReferences,
    context,
  });
  const overrides = testCase.frameOverrides;
  const frame: SemanticActionFrame = overrides
    ? {
        ...derived,
        ...overrides,
        properties: {
          ...derived.properties,
          ...(overrides.properties ?? {}),
        },
        demands: {
          ...derived.demands,
          ...(overrides.demands ?? {}),
        },
      }
    : derived;
  return { frame, context, ids };
}

describe("semantic action adversarial corpus", () => {
  for (const testCase of SEMANTIC_ACTION_CORPUS) {
    it(`${testCase.id}: selects ${testCase.expectedMode}`, () => {
      const { frame, context, ids } = setup(testCase);
      const result = adjudicateActionResolution(frame, context);
      expect(result.mode).toBe(testCase.expectedMode);

      if (["automatic_success", "automatic_failure", "conversation", "transaction", "movement"].includes(result.mode)) {
        expect(result.meaningfulUncertainty).toBe(false);
      }
      if (["unopposed_check", "opposed_contest"].includes(result.mode)) {
        expect(result.meaningfulUncertainty).toBe(true);
      }
      if (testCase.id.startsWith("routine-")) {
        expect(frame.targetIds).toEqual([]);
        expect(frame.objectIds).toEqual([]);
        expect(frame.toolIds).toEqual([]);
        expect(frame.properties.selfDirected).toBe(true);
        expect(frame.actorId).toBe(ids.actorId);
      }
      if (testCase.targetRole === "object" && testCase.objectKey) {
        expect(frame.objectIds).toContain(ids.objectId);
        expect(frame.properties.opposed).toBe(false);
      }
      if (testCase.expectedMode === "opposed_contest") {
        expect(frame.properties.opposed).toBe(true);
      }
    });
  }
});
