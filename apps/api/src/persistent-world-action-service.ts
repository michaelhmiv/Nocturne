import {
  WorldActionPlayerSafeResultSchema,
  type PersistentActionPlan,
  type RelevanceCompiledContext,
  type WorldActionKind,
  type WorldActionPlayerSafeResult,
} from "@nocturne/contracts";
import {
  AiProviderError,
  buildFastSingleStepPlan,
  decideWorldActionFastPath,
  type AiDecisionClient,
  type FastWorldActionDecision,
} from "@nocturne/ai-gm";
import type {
  NarrativeContextProjection,
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

export type WorldActionStepHandlerResult =
  WorldActionStepCompleted | WorldActionStepWaiting;

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
  readForResume(input: {
    scope: Pick<WorldScope, "worldId" | "userId">;
    requestId: string;
    actorId: string;
  }): Promise<{
    requestId: string;
    actorId: string;
    command: string;
    status: string;
    playerSafeResult: WorldActionPlayerSafeResult | null;
  }>;
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

const impossibleMovementPattern =
  /\b(?:walk|phase|pass)\b.*\bthrough\b.*\b(?:solid )?wall\b/i;

function isImpossibleMovementCommand(command: string) {
  return impossibleMovementPattern.test(command);
}

function planNarration(plan: PersistentActionPlan) {
  const active = plan.steps.find(({ stepId }) => stepId === plan.activeStepId);
  if (active?.status === "waiting") {
    return active.waitingReason || `${active.description} remains in progress.`;
  }
  if (plan.status === "completed")
    return "The requested action plan completed.";
  return active ? active.description : "The action plan is ready to continue.";
}

export function createPersistentWorldActionService(dependencies: {
  decisionClient: Pick<AiDecisionClient, "decide">;
  requests: WorldActionRequestStoreLike;
  context: RelevanceContextStore;
  references: ReferenceResolutionStore;
  plans: PersistentPlanStore;
  steps: WorldActionStepStoreLike;
  handlers: Partial<Record<WorldActionKind, WorldActionStepHandler>>;
  compileNarrativeContext(input: {
    scope: WorldScope;
    viewpointId: string;
    command: string;
  }): Promise<NarrativeContextProjection>;
  narrateCommittedEvents?(input: {
    scope: WorldScope;
    actorId: string;
    eventIds: string[];
    fallback: string;
  }): Promise<string>;
  recordCompletedTurn?(input: {
    scope: WorldScope;
    viewpointId: string;
    requestId: string;
    narration: string;
    eventIds: string[];
    mentionedEntityIds?: string[];
  }): Promise<unknown>;
  simulateReferencedEntity?(input: {
    scope: WorldScope;
    entityId: string;
    relevantFacts: string[];
  }): Promise<void>;
}) {
  const enabledHandlers = Object.entries(dependencies.handlers)
    .filter((entry): entry is [WorldActionKind, WorldActionStepHandler] =>
      Boolean(entry[1]),
    )
    .map(([kind]) => kind);

  async function failRequest(input: {
    scope: WorldScope;
    requestId: string;
    expectedStatus: string | string[];
    error: unknown;
  }) {
    const errorCode =
      input.error instanceof PersistentWorldActionServiceError ||
      input.error instanceof AiProviderError
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
          error:
            input.error instanceof Error
              ? input.error.message
              : String(input.error),
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
    /**
     * Events committed by an asynchronous resolver before it re-enters the
     * common continuation loop. They must remain part of the final durable
     * result and narration input.
     */
    initialEventIds?: string[];
  }): Promise<WorldActionPlayerSafeResult> {
    const eventIds: string[] = [...(input.initialEventIds || [])];
    const narrations: string[] = [];
    for (let iteration = 0; iteration < 64; iteration += 1) {
      const started = await dependencies.plans.startReadyStep({
        scope: input.scope,
        planId: input.planId,
      });
      if (!started) {
        const plan = await dependencies.plans.read({
          scope: input.scope,
          planId: input.planId,
        });
        if (plan.status === "completed") {
          const fallbackNarration = narrations.join(" ") || planNarration(plan);
          // Only committed events reach the creative narrator. Pending plans,
          // clarification prompts and speculative decisions are never narrated
          // as completed actions.
          const narration =
            eventIds.length > 0 && dependencies.narrateCommittedEvents
              ? await dependencies.narrateCommittedEvents({
                  scope: input.scope,
                  actorId: input.actorId,
                  eventIds,
                  fallback: fallbackNarration,
                })
              : fallbackNarration;
          const result = WorldActionPlayerSafeResultSchema.parse({
            state: "completed",
            requestId: input.requestId,
            plan,
            narration,
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
          await dependencies
            .recordCompletedTurn?.({
              scope: input.scope,
              viewpointId: input.actorId,
              requestId: input.requestId,
              narration,
              eventIds,
              mentionedEntityIds: input.context.entities.map(
                ({ entityId }) => entityId,
              ),
            })
            .catch(() => {});
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
        const plan = await dependencies.plans.read({
          scope: input.scope,
          planId: input.planId,
        });
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
          .filter(({ inclusionReasons }) =>
            inclusionReasons.includes("explicit_reference"),
          )
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
    clarificationForRequestId?: string;
  }): Promise<WorldActionPlayerSafeResult> {
    const pendingClarification = input.clarificationForRequestId
      ? await dependencies.requests.readForResume({
          scope: input.scope,
          requestId: input.clarificationForRequestId,
          actorId: input.actorId,
        })
      : null;
    if (
      pendingClarification &&
      (pendingClarification.status !== "waiting_for_clarification" ||
        pendingClarification.playerSafeResult?.state !==
          "waiting_for_clarification")
    ) {
      throw new PersistentWorldActionServiceError(
        "request_failed",
        "The referenced clarification is no longer waiting for a reply.",
      );
    }
    const command = pendingClarification
      ? `${pendingClarification.command}\nClarification: ${input.command}`.slice(
          0,
          4_000,
        )
      : input.command;
    const clarificationLineage = pendingClarification
      ? {
          clarificationForRequestId: pendingClarification.requestId,
          originalCommand: pendingClarification.command,
          clarificationReply: input.command,
        }
      : undefined;
    const reservation = await dependencies.requests.reserve({
      scope: input.scope,
      actorId: input.actorId,
      command,
      idempotencyKey: input.idempotencyKey,
    });
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
        authoritativeResult: clarificationLineage,
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
        command,
      });
      let narrative = await dependencies.compileNarrativeContext({
        scope: input.scope,
        viewpointId: input.actorId,
        command,
      });
      await dependencies.requests.stage({
        requestId: reservation.requestId,
        order: 1,
        type: "compile_context",
        status: "completed",
        outputSummary: {
          compilationId: context.compilationId,
          factCount:
            context.playerKnownFacts.length +
            context.authoritativeHiddenFacts.length,
          recentTurnCount: narrative.recentTurns.length,
          memoryCount: narrative.relevantMemories.length,
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
      const recentPlayerSafeText = narrative.recentTurns
        .flatMap((turn) => [turn.command, turn.playerSafeResult])
        .slice(-20);
      let fastDecision: FastWorldActionDecision;
      try {
        fastDecision = await decideWorldActionFastPath(
          dependencies.decisionClient,
          {
            command,
            actorId: input.actorId,
            enabledHandlers,
            recentPlayerSafeText,
            candidates,
          },
        );
      } catch (error) {
        // Provider failures are infrastructure errors, never failed player plans.
        // Preserve their typed code so the API returns 502/503/504 rather than 422.
        if (error instanceof AiProviderError) throw error;
        throw new PersistentWorldActionServiceError(
          "planning_failed",
          error instanceof Error
            ? `Jev semantic interpretation failed: ${error.message}`
            : "Jev semantic interpretation failed.",
        );
      }
      const interpretation = fastDecision.interpretation;
      const impossibleMovement =
        (fastDecision.actionType === "move" || fastDecision.kind === "move") &&
        isImpossibleMovementCommand(command);
      const clarification =
        dependencies.references.clarification(interpretation);
      const forceImpossibleMovement =
        impossibleMovement &&
        fastDecision.fallbackReasons.every((reason) =>
          ["ambiguous_reference", "clarification"].includes(reason),
        );
      await dependencies.references.recordInterpretation({
        scope: input.scope,
        viewpointId: input.actorId,
        command,
        interpretation,
        candidates,
      });
      if (clarification && !forceImpossibleMovement) {
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
          authoritativeResult: {
            ...(clarificationLineage || {}),
            semanticMode: "jev",
            decisionModel: fastDecision.actualModel,
            decisionActionType: fastDecision.actionType,
            decisionFallbackReasons: fastDecision.fallbackReasons,
          },
          playerSafeResult: result,
        });
        return result;
      }
      const resolvedEntityIds =
        dependencies.references.explicitEntityIds(interpretation);
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
          command,
          explicitEntityIds: resolvedEntityIds,
        });
        narrative = await dependencies.compileNarrativeContext({
          scope: input.scope,
          viewpointId: input.actorId,
          command,
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
        ? await dependencies.plans.read({
            scope: input.scope,
            planId: activePlanId,
          })
        : null;

      if (!fastDecision.fastPathEligible && !forceImpossibleMovement) {
        const reasons = fastDecision.fallbackReasons;
        const prompt = reasons.includes("multi_step")
          ? "Please break that into one action at a time for now."
          : reasons.includes("ambiguous_reference") ||
              reasons.includes("clarification")
            ? "Please clarify which person, place, or thing you mean."
            : "Please rephrase the action more specifically so I can map it to the world state.";
        const result = WorldActionPlayerSafeResultSchema.parse({
          state: "waiting_for_clarification",
          requestId: reservation.requestId,
          prompt,
        });
        await dependencies.requests.transition({
          scope: input.scope,
          requestId: reservation.requestId,
          expectedStatus: currentStatus,
          status: "waiting_for_clarification",
          authoritativeResult: {
            ...(clarificationLineage || {}),
            semanticMode: "jev",
            decisionModel: fastDecision.actualModel,
            decisionLatencyMs: fastDecision.latencyMs,
            decisionActionType: fastDecision.actionType,
            decisionActionTypeConfidence: fastDecision.actionTypeConfidence,
            decisionFallbackReasons: reasons,
          },
          playerSafeResult: result,
        });
        return result;
      }

      let proposal;
      try {
        proposal = buildFastSingleStepPlan({
          command,
          actorId: input.actorId,
          kind: fastDecision.kind,
          planKind: forceImpossibleMovement ? "interact" : undefined,
          actionType: fastDecision.actionType,
          selectedEntityIds: resolvedEntityIds,
          selectedEntityRoles: fastDecision.selectedEntityRoles,
          context,
        });
      } catch (error) {
        const result = WorldActionPlayerSafeResultSchema.parse({
          state: "waiting_for_clarification",
          requestId: reservation.requestId,
          prompt:
            "Please be more specific about the target, destination, or object involved.",
        });
        await dependencies.requests.transition({
          scope: input.scope,
          requestId: reservation.requestId,
          expectedStatus: currentStatus,
          status: "waiting_for_clarification",
          authoritativeResult: {
            ...(clarificationLineage || {}),
            semanticMode: "jev",
            decisionModel: fastDecision.actualModel,
            decisionLatencyMs: fastDecision.latencyMs,
            decisionActionType: fastDecision.actionType,
            decisionActionTypeConfidence: fastDecision.actionTypeConfidence,
            decisionFallbackReasons: [
              ...fastDecision.fallbackReasons,
              "deterministic_plan_compile",
            ],
            compileError:
              error instanceof Error ? error.message : String(error),
          },
          playerSafeResult: result,
        });
        return result;
      }
      const plan = await dependencies.plans.create({
        scope: input.scope,
        actorId: input.actorId,
        proposal,
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
          ...(clarificationLineage || {}),
          semanticMode: "jev",
          decisionModel: fastDecision.actualModel,
          decisionLatencyMs: fastDecision.latencyMs,
          decisionKindConfidence: fastDecision.kindConfidence,
          decisionActionType: fastDecision.actionType,
          decisionActionTypeConfidence: fastDecision.actionTypeConfidence,
          decisionMultiStepProbability: fastDecision.multiStepProbability,
          decisionFallbackReasons: fastDecision.fallbackReasons,
          decisionEntityRoles: fastDecision.selectedEntityRoles,
          contextCompilationId: context.compilationId,
          recentTurnCount: narrative.recentTurns.length,
          memoryCount: narrative.relevantMemories.length,
          activePlanIdBeforeSubmission: activePlanSummary?.planId || null,
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

export type PersistentWorldActionService = ReturnType<
  typeof createPersistentWorldActionService
>;