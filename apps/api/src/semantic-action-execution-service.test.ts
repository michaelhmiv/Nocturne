import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  ActionResolutionDecision,
  RelevanceCompiledContext,
  SemanticActionFrame,
} from "@nocturne/contracts";
import type { UniversalOperationExecutor } from "@nocturne/database";
import { createSemanticActionExecutionService } from "./semantic-action-execution-service.js";

const scope = {
  worldId: randomUUID(),
  shardId: randomUUID(),
  userId: "semantic-test-user",
  role: "player" as const,
  selectedCharacterId: randomUUID(),
};

type ExecutionInput = Parameters<UniversalOperationExecutor["execute"]>[0];
type SemanticResultState = { value: { roll: number; succeeded: boolean } };

function context(actorId: string, targetId?: string): RelevanceCompiledContext {
  const locationId = randomUUID();
  return {
    compilationId: randomUUID(),
    policyVersion: "test-v1",
    worldId: scope.worldId,
    shardId: scope.shardId,
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
      ...(targetId
        ? [
            {
              entityId: targetId,
              definitionId: "target",
              name: "Target",
              definitionType: "npc",
              locationId,
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
    playerKnownFacts: [],
    authoritativeHiddenFacts: [],
    omittedCandidateCount: 0,
    estimatedTokens: 0,
  };
}

function frame(
  actorId: string,
  kind: SemanticActionFrame["kind"],
  targetIds: string[] = [],
): SemanticActionFrame {
  return {
    kind,
    actionType: kind === "combat" ? "attack" : kind,
    objective: kind === "combat" ? "Punch the target" : "Say hello",
    actorId,
    targetIds,
    objectIds: [],
    toolIds: [],
    properties: {
      selfDirected: targetIds.length === 0,
      opposed: kind === "combat",
      destructive: false,
      illegal: false,
      social: kind === "dialogue",
      movement: false,
      continuous: false,
    },
    demands: {
      physicalEffort: kind === "combat" ? 3 : 0,
      technicalComplexity: 0,
      precision: 0,
      danger: kind === "combat" ? 3 : 0,
      timePressure: 0,
    },
    assumptions: [],
    ambiguities: [],
  };
}

function resolution(
  mode: ActionResolutionDecision["mode"],
): ActionResolutionDecision {
  return {
    mode,
    rationale: "Test resolution",
    meaningfulUncertainty: ["unopposed_check", "opposed_contest"].includes(
      mode,
    ),
    difficulty: 0,
    opposition: 0,
    consequenceLevel: 0,
    requiredFactIds: [],
  };
}

describe("semantic action execution service", () => {
  it("commits ordinary conversation through the universal executor", async () => {
    const actorId = randomUUID();
    const execute = vi.fn(async (_input: ExecutionInput) => ({
      eventId: randomUUID(),
      receiptId: randomUUID(),
      symbolMap: {},
    }));
    const service = createSemanticActionExecutionService({
      executor: { execute } as never,
      rollSecret: "semantic-test-secret",
    });

    const result = await service.execute({
      scope,
      actorId,
      planId: randomUUID(),
      stepId: randomUUID(),
      idempotencyKey: "semantic:conversation",
      frame: frame(actorId, "dialogue"),
      resolution: resolution("conversation"),
      context: context(actorId),
    });

    expect(result.outcomeGrade).toBe("complete_success");
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]![0].branch.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "set_state_value",
          path: ["activity", "last_semantic_action"],
        }),
      ]),
    );
  });

  it("commits successful combat damage as an authoritative condition operation", async () => {
    const actorId = randomUUID();
    const targetId = randomUUID();
    const execute = vi.fn(async (_input: ExecutionInput) => ({
      eventId: randomUUID(),
      receiptId: randomUUID(),
      symbolMap: {},
    }));
    const service = createSemanticActionExecutionService({
      executor: { execute } as never,
      rollSecret: "semantic-test-secret",
    });

    await service.execute({
      scope,
      actorId,
      planId: randomUUID(),
      stepId: randomUUID(),
      idempotencyKey: "semantic:combat",
      frame: frame(actorId, "combat", [targetId]),
      resolution: resolution("opposed_contest"),
      context: context(actorId, targetId),
    });

    expect(execute.mock.calls[0]![0].branch.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "adjust_condition",
          entityRef: { kind: "existing", entityId: targetId },
        }),
      ]),
    );
  });

  it("uses the same deterministic roll for the same idempotency key", async () => {
    const actorId = randomUUID();
    const calls: ExecutionInput[] = [];
    const execute = vi.fn(async (input: ExecutionInput) => {
      calls.push(input);
      return {
        eventId: randomUUID(),
        receiptId: randomUUID(),
        symbolMap: {},
      };
    });
    const service = createSemanticActionExecutionService({
      executor: { execute } as never,
      rollSecret: "semantic-test-secret",
    });
    const request = {
      scope,
      actorId,
      planId: randomUUID(),
      stepId: randomUUID(),
      idempotencyKey: "semantic:repeatable",
      frame: frame(actorId, "interact"),
      resolution: resolution("unopposed_check"),
      context: context(actorId),
    };

    await service.execute(request);
    await service.execute(request);

    const firstValue = (calls[0]!.branch.operations[0] as SemanticResultState)
      .value;
    const secondValue = (calls[1]!.branch.operations[0] as SemanticResultState)
      .value;
    expect(firstValue.roll).toBe(secondValue.roll);
    expect(firstValue.succeeded).toBe(secondValue.succeeded);
  });
});
