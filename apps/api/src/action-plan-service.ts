import { createHash } from "node:crypto";
import {
  ACTION_PLAN_POLICY_VERSION,
  DEEPSEEK_FLASH_MODEL,
  AiProviderClient,
  deterministicActionPlanFallback,
  parseActionPlanWithAi,
} from "@nocturne/ai-gm";
import {
  ActionPlanEnvelopeSchema,
  ActionPlanExecutionResponseSchema,
  SubmitActionRequestSchema,
  type ActionExecutionResponse,
  type ActionPlanEnvelope,
  type ActionPlanStepExecution,
  type ActionTravelResult,
} from "@nocturne/contracts";
import type { ActionStore } from "@nocturne/database";
import type { ActionService } from "./action-service.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const dependentSuccessGrades = new Set(["complete_success", "success_with_consequence"]);
const meaningfulProgressGrades = new Set([
  "complete_success",
  "success_with_consequence",
  "partial_success",
  "failure_with_progress",
]);

type ActionPlanExecutionOptions = {
  existingPlan?: ActionPlanEnvelope;
  persistPlan?: (plan: ActionPlanEnvelope) => Promise<void>;
};

export function createActionPlanService(
  actionStore: ActionStore,
  actions: ActionService,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const client = new AiProviderClient({ deepseekApiKey: environment.DEEPSEEK_API_KEY });

  async function createPlan(
    userId: string,
    input: ReturnType<typeof SubmitActionRequestSchema.parse>,
    idempotencyKey: string,
  ): Promise<ActionPlanEnvelope> {
    const context = await actionStore.getContext(
      userId,
      input.actorId,
      input.methodInstanceId,
      input.targetLocationId,
    );
    const planRun = await actionStore.startAiRun({
      task: "parse_intent",
      authority: "authoritative",
      requestedModel: DEEPSEEK_FLASH_MODEL,
      policyVersion: ACTION_PLAN_POLICY_VERSION,
      inputHash: hash({ input, publicContext: context.publicContext }),
      metadata: { actorId: input.actorId, idempotencyKey, mode: "ordered_plan" },
    });

    try {
      if (
        !environment.DEEPSEEK_API_KEY &&
        environment.NOCTURNE_ALLOW_DETERMINISTIC_AI_FALLBACK === "true"
      ) {
        const plan = deterministicActionPlanFallback(
          input,
          context.method.definitionId,
          context.targetLocation.id,
        );
        await actionStore.finishAiRun(
          planRun,
          "deterministic-development-fallback",
          undefined,
          hash(plan),
        );
        return plan;
      }

      const result = await parseActionPlanWithAi(client, input, context.publicContext);
      await actionStore.finishAiRun(
        planRun,
        result.actualModel,
        result.providerRequestId,
        hash(result.data),
      );
      return result.data;
    } catch (error) {
      await actionStore.failAiRun(
        planRun,
        error instanceof Error && "code" in error
          ? String((error as { code: unknown }).code)
          : "action_plan_failed",
      );
      throw error;
    }
  }

  async function execute(
    userId: string,
    rawInput: unknown,
    idempotencyKey: string,
    options: ActionPlanExecutionOptions = {},
  ) {
    const input = SubmitActionRequestSchema.parse(rawInput);
    const plan = options.existingPlan
      ? ActionPlanEnvelopeSchema.parse(options.existingPlan)
      : await createPlan(userId, input, idempotencyKey);

    if (!options.existingPlan && options.persistPlan) {
      await options.persistPlan(plan);
    }

    const steps: ActionPlanStepExecution[] = [];
    let previousSatisfied = true;
    let allCompletedReplayed = true;
    const stepKeyBase = idempotencyKey.slice(0, 220);

    for (const [index, step] of plan.steps.entries()) {
      if (step.dependsOnPreviousSuccess && !previousSatisfied) {
        steps.push({
          stepId: step.stepId,
          order: index + 1,
          rawText: step.rawText,
          actionType: step.actionType,
          objective: step.objective,
          dependsOnPreviousSuccess: true,
          status: "skipped",
          skipReason: "The immediately preceding prerequisite did not fully succeed.",
        });
        previousSatisfied = false;
        continue;
      }

      const result = (await actions.execute(
        userId,
        {
          actorId: input.actorId,
          rawText: step.rawText,
          methodInstanceId: input.methodInstanceId,
          targetLocationId: step.targetLocationId ?? input.targetLocationId,
        },
        `${stepKeyBase}:step:${index + 1}`,
      )) as ActionExecutionResponse & { travel?: ActionTravelResult };
      allCompletedReplayed = allCompletedReplayed && result.idempotentReplay;

      steps.push({
        stepId: step.stepId,
        order: index + 1,
        rawText: step.rawText,
        actionType: step.actionType,
        objective: step.objective,
        dependsOnPreviousSuccess: step.dependsOnPreviousSuccess,
        status: "completed",
        outcomeGrade: result.outcomeGrade,
        eventId: result.eventId,
        narration: result.narration,
        ...(result.consumption ? { consumption: result.consumption } : {}),
        ...(result.travel ? { travel: result.travel } : {}),
      });
      previousSatisfied = dependentSuccessGrades.has(result.outcomeGrade);
    }

    const completed = steps.filter(
      (step): step is ActionPlanStepExecution & { outcomeGrade: string } =>
        step.status === "completed" && Boolean(step.outcomeGrade),
    );
    const allStrongSuccess =
      completed.length === steps.length &&
      completed.every((step) => dependentSuccessGrades.has(step.outcomeGrade));
    const anyProgress = completed.some((step) => meaningfulProgressGrades.has(step.outcomeGrade));
    const overallStatus = allStrongSuccess
      ? "complete_success"
      : anyProgress
        ? "partial_success"
        : completed.length
          ? "failure"
          : "invalid";

    const locationId = await actionStore.getActorLocation(input.actorId);
    const actorState = await actionStore.readActorState(input.actorId);
    const pendingTravelTo =
      [...steps]
        .reverse()
        .find((step) => step.travel?.scheduled)
        ?.travel?.to ?? null;
    const narration = steps
      .map((step) =>
        step.status === "completed"
          ? step.narration || `${step.objective} resolves.`
          : `${step.objective} is skipped because its prerequisite did not succeed.`,
      )
      .join("\n\n");

    return ActionPlanExecutionResponseSchema.parse({
      planId: `plan-${hash({ userId, idempotencyKey }).slice(0, 24)}`,
      rawText: input.rawText,
      summary: plan.summary,
      overallStatus,
      steps,
      narration,
      finalState: {
        locationId: locationId || null,
        actorStatus: String(actorState.status || "active"),
        pendingTravelTo,
      },
      idempotentReplay: completed.length > 0 && allCompletedReplayed,
    });
  }

  return { execute };
}

export type ActionPlanService = ReturnType<typeof createActionPlanService>;
