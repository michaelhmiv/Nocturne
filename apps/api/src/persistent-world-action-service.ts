import {
  WorldActionPlayerSafeResultSchema,
  WorldActionPlannerRequestSchema,
  type PersistentActionPlan,
  type RelevanceCompiledContext,
  type WorldActionKind,
  type WorldActionPlayerSafeResult,
} from "@nocturne/contracts";
import {
  interpretEntityReferences,
  planPersistentWorldAction,
  type AiProviderClient,
} from "@nocturne/ai-gm";
import type {
  PersistentPlanStore,
  ReferenceResolutionStore,
  RelevanceContextStore,
  WorldScope,
} from "@nocturne/database";
import type { ExecutableWorldActionStep } from "../../../packages/database/src/world-action-step-store.js";

export type WorldActionStepCompleted = {
  state: "completed";
  outcomeGrade: string;
  eventId: string;
  receiptId?: string;
  narration: string;
};

export type WorldActionStepWaiting = {
  state: "waiting";
  planStatus: "waiting_for_time" | "waiting_for_world_event";
  reason: string;
  narration: string;
  scheduleId?: string;
};

export type WorldActionStepHandlerResult = WorldActionStepCompleted | WorldActionStepWaiting;

export type WorldActionStepHandler = (input: {
  scope: WorldScope;
  requestId: string;
  planId: string;
  actorId: string;
  step: ExecutableWorldActionStep;
  context: RelevanceCompiledContext;
}) => Promise<WorldActionStepHandlerResult>;

type WorldActionRequestRecord = {
  requestId: string;
  status: string;
  requestHash: string;
  planId: string | null;
  playerSafeResult: WorldActionPlayerSafeResult | null;
  created: boolean;
};

type WorldActionRequestStoreLike = {
  reserve(input: {
    scope: WorldScope;
    actorId: string;
    command: string;
    idempotencyKey: string;
  }): Promise<WorldActionRequestRecord>;
  transition(input: {
    scope: Pick<WorldScope, "worldId">;
    requestId: string;
    expectedStatus: string | string[];
    status: string;
    contextCompilationId?: string;
    planId?: string;
    authoritativeResult?: Record<string, unknown>;
    playerSafeResult?: WorldActionPlayerSafeResult;
    errorCode?: string;
  }): Promise<string>;
  stage(input: {
    requestId: string;
    order: number;
    type: string;
    status: "started" | "completed" | "failed" | "waiting" | "skipped";
    inputSummary?: Record<string, unknown>;
    outputSummary?: Record<string, unknown>;
  }): Promise<void>;
  get(input: {
    scope: Pick<WorldScope, "worldId">;
    requestId: string;
  }): Promise<{
    request_id: string;
    status: string;
    plan_id: string | null;
    player_safe_result: WorldActionPlayerSafeResult | null;
    error_code: string | null;
  }>;
};

type WorldActionStepStoreLike = {
  readExecutable(input: {
    scope: Pick<WorldScope, "worldId">;
    planId: string;
    stepId: string;
  }): Promise<ExecutableWorldActionStep | null>;
  markWaiting(input: {
    scope: Pick<WorldScope, "worldId">;
    planId: string;
    stepId: string;
    reason: string;
    scheduleId?: string;
  }): Promise<void>;
  failStep(input: {
    scope: Pick<WorldScope, "worldId">;
    planId: string;
    stepId: string;
    failureCode: string;
    eventId?: string;
  }): Promise<void>;
};

export class PersistentWorldActionServiceError extends Error {
  constructor(
    readonly code:
      | "in_progress"
      | "unsupported_handler"
      | "planning_failed"
      | "step_failed"
      | "request_failed",
    message: string,
  ) {
    super(message);
    this.name = "PersistentWorldActionServiceError";
  }
}

function planNarration(plan: PersistentActionPlan) {
  const active = plan.steps.find(({ stepId }) => stepId === plan.activeStepId);
  if (active?.status === "waiting") {
    return active.waitingReason || `${active.description} remains in progress.`;
  }
  if (plan.status === "completed") return "The requested action plan completed.";
  return active ? active.description : "The action plan is ready to continue.";
}

export function createPersistentWorldActionService(dependencies: {
  client: Pick<AiProviderClient, "generateStructured">;
  requests: WorldActionRequestStoreLike;
  context: RelevanceContextStore;
  references: ReferenceResolutionStore;
  plans: PersistentPlanStore;
  steps: WorldActionStepStoreLike;
  handlers: Partial<Record<WorldActionKind, WorldActionStepHandler>>;
  listRecentPlayerSafeText(input: {
    scope: WorldScope;
    limit: number;
  }): Promise<string[]>;
  simulateReferencedEntity?(input: {
    scope: WorldScope;
    entityId: string;
    relevantFacts: string[];
  }): Promise<void>;
}) {
  const enabledHandlers = Object.entries(dependencies.handlers)
    .filter((entry): entry is [WorldActionKind, WorldActionStepHandler] => Boolean(entry[1]))
    .map(([kind]) => kind);

  async function failRequest(input: {
    scope: WorldScope;
    requestId: string;
    expectedStatus: string | string[];
    error: unknown;
  }) {
    const errorCode =
      input.error instanceof PersistentWorldActionServiceError
        ? input.error.code
        : "request_failed";
    await dependencies.requests
      .transition({
        scope: input.scope,
        requestId: input.requestId,
        expectedStatus: input.expectedStatus,
        status: "failed",
        errorCode,
        authoritativeResult: {
          error: input.error instanceof Error ? input.error.message : String(input.error),
        },
      })
      .catch(() => {});
  }

  async function executePlan(input: {
    scope: WorldScope;
    requestId: string;
    actorId: string;
    planId: string;
    context: RelevanceCompiledContext;
  }): Promise<WorldActionPlayerSafeResult> {
    const eventIds: string[] = [];
    const narrations: string[] = [];
    for (let iteration = 0; iteration < 64; iteration += 1) {
      const started = await dependencies.plans.startReadyStep({
        scope: input.scope,
        planId: input.planId,
      });
      if (!started) {
        const plan = await dependencies.plans.read({ scope: input.scope, planId: input.planId });
        if (plan.status === "completed") {
          const result = WorldActionPlayerSafeResultSchema.parse({
            state: "completed",
            requestId: input.requestId,
            plan,
            narration: narrations.join(" ") || planNarration(plan),
            eventIds,
          });
          await dependencies.requests.transition({
            scope: input.scope,
            requestId: input.requestId,
            expectedStatus: ["executing", "waiting"],
            status: "completed",
            planId: input.planId,
            authoritativeResult: { eventIds },
            playerSafeResult: result,
          });
          return result;
        }
        const result = WorldActionPlayerSafeResultSchema.parse({
          state: "waiting",
          requestId: input.requestId,
          plan,
          narration: narrations.join(" ") || planNarration(plan),
        });
        await dependencies.requests.transition({
          scope: input.scope,
          requestId: input.requestId,
          expectedStatus: ["executing", "waiting"],
          status: "waiting",
          planId: input.planId,
          playerSafeResult: result,
        });
        return result;
      }

      const step = await dependencies.steps.readExecutable({
        scope: input.scope,
        planId: input.planId,
        stepId: started.stepId,
      });
      if (!step) {
        throw new PersistentWorldActionServiceError(
          "step_failed",
          "Ready action-plan step could not be loaded.",
        );
      }
      const handler = dependencies.handlers[step.kind as WorldActionKind];
      if (!handler) {
        await dependencies.steps.failStep({
          scope: input.scope,
          planId: input.planId,
          stepId: step.stepId,
          failureCode: "unsupported_handler",
        });
        throw new PersistentWorldActionServiceError(
          "unsupported_handler",
          `No enabled handler exists for ${step.kind}.`,
        );
      }

      let handled: WorldActionStepHandlerResult;
      try {
        handled = await handler({
          scope: input.scope,
          requestId: input.requestId,
          planId: input.planId,
          actorId: input.actorId,
          step,
          context: input.context,
        });
      } catch (error) {
        await dependencies.steps.failStep({
          scope: input.scope,
          planId: input.planId,
          stepId: step.stepId,
          failureCode: "handler_failed",
        });
        throw new PersistentWorldActionServiceError(
          "step_failed",
          error instanceof Error ? error.message : "World action step failed.",
        );
      }

      if (handled.state === "waiting") {
        await dependencies.steps.markWaiting({
          scope: input.scope,
          planId: input.planId,
          stepId: step.stepId,
          reason: handled.reason,
          scheduleId: handled.scheduleId,
        });
        const currentPlan = await dependencies.plans.read({
          scope: input.scope,
          planId: input.planId,
        });
        await dependencies.plans.transitionPlan({
          scope: input.scope,
          planId: input.planId,
          expectedVersion: currentPlan.planVersion,
          status: handled.planStatus,
          activeStepId: step.stepId,
          eventType: "step_waiting",
          payload: {
            stepId: step.stepId,
            reason: handled.reason,
            scheduleId: handled.scheduleId || null,
          },
        });
        narrations.push(handled.narration);
        const plan = await dependencies.plans.read({ scope: input.scope, planId: input.planId });
        const result = WorldActionPlayerSafeResultSchema.parse({
          state: "waiting",
          requestId: input.requestId,
          plan,
          narration: narrations.join(" "),
        });
        await dependencies.requests.transition({
          scope: input.scope,
          requestId: input.requestId,
          expectedStatus: "executing",
          status: "waiting",
          planId: input.planId,
          playerSafeResult: result,
        });
        return result;
      }

      eventIds.push(handled.eventId);
      narrations.push(handled.narration);
      await dependencies.plans.completeStep({
        scope: input.scope,
        planId: input.planId,
        stepId: step.stepId,
        outcomeGrade: handled.outcomeGrade,
        resultEventId: handled.eventId,
        resultReceiptId: handled.receiptId,
      });
      input.context = await dependencies.context.compile({
        scope: input.scope,
        viewpointId: input.actorId,
        command: input.context.commandExcerpt,
        explicitEntityIds: input.context.entities
          .filter(({ inclusionReasons }) => inclusionReasons.includes("explicit_reference"))
          .map(({ entityId }) => entityId),
        activePlanId: input.planId,
      });
    }
    throw new PersistentWorldActionServiceError(
      "step_failed",
      "Action plan exceeded the bounded synchronous continuation limit.",
    );
  }

  async function submit(input: {
    scope: WorldScope;
    actorId: string;
    command: string;
    idempotencyKey: string;
  }): Promise<WorldActionPlayerSafeResult> {
    const reservation = await dependencies.requests.reserve(input);
    if (!reservation.created) {
      if (reservation.playerSafeResult) return reservation.playerSafeResult;
      if (reservation.planId) {
        const plan = await dependencies.plans.read({
          scope: input.scope,
          planId: reservation.planId,
        });
        return WorldActionPlayerSafeResultSchema.parse({
          state: "waiting",
          requestId: reservation.requestId,
          plan,
          narration: planNarration(plan),
        });
      }
      throw new PersistentWorldActionServiceError(
        "in_progress",
        "The same world action is already being processed.",
      );
    }

    let currentStatus = "reserved";
    try {
      await dependencies.requests.transition({
        scope: input.scope,
        requestId: reservation.requestId,
        expectedStatus: currentStatus,
        status: "compiling_context",
      });
      currentStatus = "compiling_context";
      await dependencies.requests.stage({
        requestId: reservation.requestId,
        order: 1,
        type: "compile_context",
        status: "started",
        inputSummary: { actorId: input.actorId },
      });
      let context = await dependencies.context.compile({
        scope: input.scope,
        viewpointId: input.actorId,
        command: input.command,
      });
      await dependencies.requests.stage({
        requestId: reservation.requestId,
        order: 1,
        type: "compile_context",
        status: "completed",
        outputSummary: {
          compilationId: context.compilationId,
          factCount: context.playerKnownFacts.length + context.authoritativeHiddenFacts.length,
        },
      });
      await dependencies.requests.transition({
        scope: input.scope,
        requestId: reservation.requestId,
        expectedStatus: currentStatus,
        status: "resolving_references",
        contextCompilationId: context.compilationId,
      });
      currentStatus = "resolving_references";

      const candidates = await dependencies.references.buildCandidates({
        scope: input.scope,
        viewpointId: input.actorId,
        context,
      });
      const recentPlayerSafeText = await dependencies.listRecentPlayerSafeText({
        scope: input.scope,
        limit: 20,
      });
      const interpreted = await interpretEntityReferences(dependencies.client, {
        command: input.command,
        viewpointId: input.actorId,
        recentPlayerSafeText,
        candidates,
      });
      await dependencies.references.recordInterpretation({
        scope: input.scope,
        viewpointId: input.actorId,
        command: input.command,
        interpretation: interpreted.data,
        candidates,
      });
      const clarification = dependencies.references.clarification(interpreted.data);
      if (clarification) {
        const result = WorldActionPlayerSafeResultSchema.parse({
          state: "waiting_for_clarification",
          requestId: reservation.requestId,
          prompt: clarification,
        });
        await dependencies.requests.transition({
          scope: input.scope,
          requestId: reservation.requestId,
          expectedStatus: currentStatus,
          status: "waiting_for_clarification",
          playerSafeResult: result,
        });
        return result;
      }
      const resolvedEntityIds = dependencies.references.explicitEntityIds(interpreted.data);
      if (resolvedEntityIds.length) {
        for (const entityId of resolvedEntityIds) {
          await dependencies.simulateReferencedEntity?.({
            scope: input.scope,
            entityId,
            relevantFacts: context.playerKnownFacts
              .filter((fact) => fact.entityId === entityId)
              .map((fact) => `${fact.claim}=${JSON.stringify(fact.value)}`),
          });
        }
        context = await dependencies.context.compile({
          scope: input.scope,
          viewpointId: input.actorId,
          command: input.command,
          explicitEntityIds: resolvedEntityIds,
        });
      }

      await dependencies.requests.transition({
        scope: input.scope,
        requestId: reservation.requestId,
        expectedStatus: currentStatus,
        status: "planning",
        contextCompilationId: context.compilationId,
      });
      currentStatus = "planning";
      const activePlanId = await dependencies.plans.findActive({
        scope: input.scope,
        actorId: input.actorId,
      });
      const activePlanSummary = activePlanId
        ? await dependencies.plans.read({ scope: input.scope, planId: activePlanId })
        : null;
      const plannerInput = WorldActionPlannerRequestSchema.parse({
        command: input.command,
        actorId: input.actorId,
        playerKnownFacts: context.playerKnownFacts,
        resolvedEntityIds,
        activePlanSummary,
        enabledHandlers,
      });
      const planned = await planPersistentWorldAction(dependencies.client, plannerInput);
      if (planned.data.requiresClarification) {
        const result = WorldActionPlayerSafeResultSchema.parse({
          state: "waiting_for_clarification",
          requestId: reservation.requestId,
          prompt: planned.data.clarificationPrompt,
        });
        await dependencies.requests.transition({
          scope: input.scope,
          requestId: reservation.requestId,
          expectedStatus: currentStatus,
          status: "waiting_for_clarification",
          authoritativeResult: { plannerRationale: planned.data.rationale },
          playerSafeResult: result,
        });
        return result;
      }
      if (!planned.data.plan) {
        throw new PersistentWorldActionServiceError(
          "planning_failed",
          "Planner did not return an executable plan.",
        );
      }
      const plan = await dependencies.plans.create({
        scope: input.scope,
        actorId: input.actorId,
        proposal: planned.data.plan,
        idempotencyRoot: input.idempotencyKey,
        conflictDecision: activePlanId ? "supersede_existing" : "reject",
      });
      await dependencies.requests.transition({
        scope: input.scope,
        requestId: reservation.requestId,
        expectedStatus: currentStatus,
        status: "executing",
        planId: plan.planId,
        authoritativeResult: {
          plannerRationale: planned.data.rationale,
          contextCompilationId: context.compilationId,
        },
      });
      currentStatus = "executing";
      return executePlan({
        scope: input.scope,
        requestId: reservation.requestId,
        actorId: input.actorId,
        planId: plan.planId,
        context,
      });
    } catch (error) {
      await failRequest({
        scope: input.scope,
        requestId: reservation.requestId,
        expectedStatus: currentStatus,
        error,
      });
      throw error;
    }
  }

  return { submit, executePlan };
}

export type PersistentWorldActionService = ReturnType<typeof createPersistentWorldActionService>;
