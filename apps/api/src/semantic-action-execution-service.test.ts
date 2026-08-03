import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type {
  ActionResolutionDecision,
  RelevanceCompiledContext,
  SemanticActionFrame,
} from "@nocturne/contracts";
import type { UniversalOperationExecutionInput } from "@nocturne/database";
import { createSemanticActionExecutionService } from "./semantic-action-execution-service.js";

const scope = {
  worldId: randomUUID(),
  shardId: randomUUID(),
  userId: "semantic-test-user",
  role: "player" as const,
  selectedCharacterId: randomUUID(),
};

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
    references: targetIds.map((targetId, index) => ({
      referenceKey: `target_${index + 1}`,
      originalText: "target",
      normalizedText: "target",
      role: "target",
      required: true,
      relationship: "visible",
      resolution: "resolved_entity",
      resolvedEntityId: targetId,
      candidateEntityIds: [],
      allowClarification: true,
    })),
    claims: [],
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

function resolution(mode: ActionResolutionDecision["mode"]): ActionResolutionDecision {
  return {
    mode,
    rationale: "Test resolution",
    meaningfulUncertainty: ["unopposed_check", "opposed_contest"].includes(mode),
    difficulty: 0,
    opposition: 0,
    consequenceLevel: 0,
    requiredFactIds: [],
  };
}

function operationValues(input: UniversalOperationExecutionInput) {
  const branch = input.branch as { operations: Array<Record<string, unknown>> };
  return branch.operations;
}

function serviceMocks() {
  const execute = vi.fn(async (_input: UniversalOperationExecutionInput) => ({
    eventId: randomUUID(),
    receiptId: randomUUID(),
    symbolMap: {},
  }));
  const record = vi.fn(async (input: { eventType: string }) => ({
    eventId: randomUUID(),
    receiptId: randomUUID(),
    eventType: input.eventType,
    idempotentReplay: false,
  }));
  return {
    execute,
    record,
    service: createSemanticActionExecutionService({
      executor: { execute } as never,
      nonMutatingEvents: { record } as never,
      rollSecret: "semantic-test-secret",
    }),
  };
}

describe("semantic action execution service", () => {
  it("records conversation without writing actor state", async () => {
    const actorId = randomUUID();
    const { service, execute, record } = serviceMocks();

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
    expect(execute).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "dialogue_occurred",
        payload: expect.objectContaining({
          succeeded: true,
          frame: expect.objectContaining({ kind: "dialogue" }),
        }),
      }),
    );
  });

  it("records questions without creating authoritative information assets", async () => {
    const actorId = randomUUID();
    const { service, execute, record } = serviceMocks();
    await service.execute({
      scope,
      actorId,
      planId: randomUUID(),
      stepId: randomUUID(),
      idempotencyKey: "semantic:question",
      frame: frame(actorId, "question"),
      resolution: resolution("conversation"),
      context: context(actorId),
    });
    expect(execute).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "question_asked" }));
  });

  it("records failed no-effect attempts without a mutation", async () => {
    const actorId = randomUUID();
    const { service, execute, record } = serviceMocks();
    await service.execute({
      scope,
      actorId,
      planId: randomUUID(),
      stepId: randomUUID(),
      idempotencyKey: "semantic:failed",
      frame: frame(actorId, "interact"),
      resolution: resolution("automatic_failure"),
      context: context(actorId),
    });
    expect(execute).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ eventType: "action_failed" }));
  });

  it("commits successful combat damage through the mutation executor", async () => {
    const actorId = randomUUID();
    const targetId = randomUUID();
    const { service, execute, record } = serviceMocks();

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

    expect(record).not.toHaveBeenCalled();
    expect(operationValues(execute.mock.calls[0]![0])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "adjust_condition",
          entityRef: { kind: "existing", entityId: targetId },
        }),
      ]),
    );
  });

  it("commits proportional injury and an active condition for hazardous self-actions", async () => {
    const actorId = randomUUID();
    const { service, execute, record } = serviceMocks();
    const hazardousFrame = frame(actorId, "interact");
    hazardousFrame.actionType = "strike";
    hazardousFrame.objective = "Strike my forehead against the doorframe";
    hazardousFrame.demands.danger = 7;
    hazardousFrame.references = [
      {
        referenceKey: "anatomy_forehead",
        originalText: "forehead",
        normalizedText: "forehead",
        role: "anatomy",
        required: true,
        relationship: "intrinsic",
        resolution: "resolved_intrinsic",
        candidateEntityIds: [],
        allowClarification: false,
      },
    ];
    hazardousFrame.claims = [
      {
        claimKey: "anatomy_forehead",
        claimType: "anatomy",
        sourceText: "forehead",
        normalizedValue: "forehead",
        required: true,
        referenceKey: "anatomy_forehead",
      },
    ];
    const hazardousResolution = resolution("unopposed_check");
    hazardousResolution.consequenceLevel = 7;

    const result = await service.execute({
      scope,
      actorId,
      planId: randomUUID(),
      stepId: randomUUID(),
      idempotencyKey: "semantic:self-hazard",
      frame: hazardousFrame,
      resolution: hazardousResolution,
      context: context(actorId),
    });

    expect(record).not.toHaveBeenCalled();
    expect(result.outcomeGrade).toBe("success_with_consequence");
    expect(result.narration).toMatch(/costs 7 condition/i);
    expect(operationValues(execute.mock.calls[0]![0])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "adjust_condition",
          entityRef: { kind: "existing", entityId: actorId },
          delta: -7,
        }),
        expect.objectContaining({
          type: "set_condition",
          entityRef: { kind: "existing", entityId: actorId },
          condition: "self_inflicted_injury",
          active: true,
        }),
      ]),
    );
  });

  it("uses the same deterministic roll for the same idempotency key", async () => {
    const actorId = randomUUID();
    const { service, record } = serviceMocks();
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

    const firstRoll = (record.mock.calls[0]![0] as { payload: { roll: number } }).payload.roll;
    const secondRoll = (record.mock.calls[1]![0] as { payload: { roll: number } }).payload.roll;
    expect(firstRoll).toBe(secondRoll);
  });
});
