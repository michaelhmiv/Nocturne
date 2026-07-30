import { createHash } from "node:crypto";
import {
  ACTION_PLAN_POLICY_VERSION,
  DEEPSEEK_FLASH_MODEL,
  AiProviderClient,
  deterministicActionPlanFallback,
  parseActionPlanWithAi,
} from "@nocturne/ai-gm";
import { getSessionFromNodeHeaders } from "@nocturne/auth";
import {
  ActionPlanExecutionResponseSchema,
  SubmitActionRequestSchema,
  type ActionExecutionResponse,
  type ActionPlanStepExecution,
  type ActionTravelResult,
} from "@nocturne/contracts";
import {
  PersistentWorldError,
  createActionStore,
  createAgentStore,
  createConsumptionStore,
  createDatabase,
  createLocationStore,
  createPersistentWorldStore,
} from "@nocturne/database";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAgentScope, requireBoundCharacter } from "./agent-scope.js";
import { createActionService } from "./action-service.js";
import { createPersistentWorldService } from "./persistent-world.js";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const dependentSuccessGrades = new Set(["complete_success", "success_with_consequence"]);
const meaningfulProgressGrades = new Set([
  "complete_success",
  "success_with_consequence",
  "partial_success",
  "failure_with_progress",
]);

export async function registerActionPlanRoutesFromEnv(app: FastifyInstance) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for action plan routes.");

  const database = createDatabase(databaseUrl);
  const actionStore = createActionStore(database);
  const locations = createLocationStore(database);
  const actions = createActionService(
    actionStore,
    process.env,
    locations,
    createConsumptionStore(database),
  );
  const agents = createAgentStore(database);
  const world = createPersistentWorldService(createPersistentWorldStore(database));
  const client = new AiProviderClient({ deepseekApiKey: process.env.DEEPSEEK_API_KEY });

  async function requireUser(
    headers: Record<string, string | string[] | undefined>,
    actorId: string,
  ) {
    const authorization = headers.authorization ?? headers.Authorization;
    const bearer = Array.isArray(authorization) ? authorization[0] : authorization;
    const agent = await agents.authenticate(bearer);
    if (agent) {
      requireAgentScope(agent, "action:submit");
      requireBoundCharacter(agent, actorId);
      return { id: agent.userId };
    }
    if (
      process.env.NOCTURNE_GUEST_MODE === "true" &&
      headers["x-nocturne-guest-mode"] === "1"
    ) {
      return { id: process.env.NOCTURNE_GUEST_USER_ID || "nocturne-test-guest" };
    }
    const session = await getSessionFromNodeHeaders(headers);
    if (!session) throw new PersistentWorldError("forbidden", "Authentication is required.");
    return session.user;
  }

  app.post("/v1/action-plans", async (request) => {
    const input = SubmitActionRequestSchema.parse(request.body);
    const user = await requireUser(request.headers, input.actorId);
    const character = await world.getCharacter(user.id, input.actorId);
    if (!character) {
      throw new PersistentWorldError(
        "forbidden",
        "Character is not available to this account.",
      );
    }
    const idempotencyKey = z
      .string()
      .trim()
      .min(1)
      .max(256)
      .parse(request.headers["idempotency-key"]);

    const context = await actionStore.getContext(
      user.id,
      input.actorId,
      input.methodInstanceId,
      input.targetLocationId,
    );
    const planInputHash = hash({ input, publicContext: context.publicContext });
    const planRun = await actionStore.startAiRun({
      task: "parse_intent",
      authority: "authoritative",
      requestedModel: DEEPSEEK_FLASH_MODEL,
      policyVersion: ACTION_PLAN_POLICY_VERSION,
      inputHash: planInputHash,
      metadata: { actorId: input.actorId, idempotencyKey, mode: "ordered_plan" },
    });

    let plan;
    try {
      if (
        !process.env.DEEPSEEK_API_KEY &&
        process.env.NOCTURNE_ALLOW_DETERMINISTIC_AI_FALLBACK === "true"
      ) {
        plan = deterministicActionPlanFallback(
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
      } else {
        const result = await parseActionPlanWithAi(client, input, context.publicContext);
        plan = result.data;
        await actionStore.finishAiRun(
          planRun,
          result.actualModel,
          result.providerRequestId,
          hash(plan),
        );
      }
    } catch (error) {
      await actionStore.failAiRun(
        planRun,
        error instanceof Error && "code" in error
          ? String((error as { code: unknown }).code)
          : "action_plan_failed",
      );
      throw error;
    }

    const steps: ActionPlanStepExecution[] = [];
    let previousSatisfied = true;
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
        user.id,
        {
          actorId: input.actorId,
          rawText: step.rawText,
          methodInstanceId: input.methodInstanceId,
          targetLocationId: step.targetLocationId ?? input.targetLocationId,
        },
        `${stepKeyBase}:step:${index + 1}`,
      )) as ActionExecutionResponse & { travel?: ActionTravelResult };

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
      planId: `plan-${hash({ userId: user.id, idempotencyKey }).slice(0, 24)}`,
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
      idempotentReplay:
        completed.length > 0 &&
        completed.every((step) => {
          const eventStep = steps.find((candidate) => candidate.eventId === step.eventId);
          return Boolean(eventStep);
        }),
    });
  });

  app.addHook("onClose", async () => database.close());
}
