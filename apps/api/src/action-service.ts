import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  ACTION_PARSE_POLICY_VERSION,
  EVENT_NARRATION_POLICY_VERSION,
  OpenRouterClient,
  deterministicActionFallback,
  deterministicNarrationFallback,
  narrateCommittedEvent,
  parseActionWithAi,
} from "@nocturne/ai-gm";
import {
  SubmitActionRequestSchema,
  type ActionExecutionResponse,
  type ParsedActionEnvelope,
} from "@nocturne/contracts";
import type { ActionStore } from "@nocturne/database";
import {
  buildDetectionOperations,
  deriveDetectionContest,
  resolveContest,
} from "@nocturne/rules-engine";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export function createActionService(store: ActionStore, environment = process.env) {
  const client = new OpenRouterClient({
    apiKey: environment.OPENROUTER_API_KEY,
    baseUrl: environment.OPENROUTER_BASE_URL,
    httpReferer: environment.OPENROUTER_HTTP_REFERER,
    appName: environment.OPENROUTER_APP_NAME,
  });

  async function execute(
    userId: string,
    rawInput: unknown,
    idempotencyKey: string = randomUUID(),
  ): Promise<ActionExecutionResponse> {
    const prior = await store.findByIdempotency(userId, idempotencyKey);
    if (prior) return prior;

    const input = SubmitActionRequestSchema.parse(rawInput);
    const context = await store.getContext(
      userId,
      input.actorId,
      input.methodInstanceId,
      input.targetLocationId,
    );

    let parsed: ParsedActionEnvelope;
    const parseRun = await store.startAiRun({
      task: "parse_intent",
      authority: "authoritative",
      requestedModel: "openrouter/free",
      policyVersion: ACTION_PARSE_POLICY_VERSION,
      inputHash: hash({ input, context: context.publicContext }),
      metadata: { actorId: input.actorId, idempotencyKey },
    });

    try {
      if (
        !environment.OPENROUTER_API_KEY &&
        environment.NOCTURNE_ALLOW_DETERMINISTIC_AI_FALLBACK === "true"
      ) {
        parsed = deterministicActionFallback(
          input,
          context.method.definitionId,
          context.targetLocation.id,
        );
        await store.finishAiRun(
          parseRun,
          "deterministic-development-fallback",
          undefined,
          hash(parsed),
        );
      } else {
        const result = await parseActionWithAi(client, input, context.publicContext);
        parsed = result.data;
        await store.finishAiRun(
          parseRun,
          result.actualModel,
          result.providerRequestId,
          hash(parsed),
        );
      }
    } catch (error) {
      await store.failAiRun(
        parseRun,
        error instanceof Error && "code" in error
          ? String((error as { code: unknown }).code)
          : "parse_failed",
      );
      throw error;
    }

    if (parsed.intent.actorId !== input.actorId) {
      throw new Error("Parsed actor does not match the authenticated command actor.");
    }
    // ponytail: override AI mistakes for the single supported action type in v0.1
    if (parsed.intent.actionType !== "detect") {
      parsed = deterministicActionFallback(
        input,
        context.method.definitionId,
        context.targetLocation.id,
      );
    }
    if (!parsed.intent.methodDefinitionIds.includes(context.method.definitionId)) {
      parsed.intent.methodDefinitionIds = [context.method.definitionId];
    }
    if (!parsed.intent.targetIds.includes(context.targetLocation.id)) {
      parsed.intent.targetIds = [context.targetLocation.id];
    }

    const allowedFacts = new Set(context.publicFacts);
    // ponytail: filter out AI-invented facts instead of rejecting the whole action
    parsed.relevantContextFacts = parsed.relevantContextFacts.filter((fact) =>
      allowedFacts.has(fact),
    );
    const modifiers = parsed.proposedModifiers
      .filter((modifier) => allowedFacts.has(modifier.citedContextFact))
      .map((modifier) => ({
        factorId: modifier.factorId,
        value: modifier.value,
        reason: modifier.reason,
        sourceId: modifier.sourceId,
      }));

    const derived = deriveDetectionContest({
      method: {
        instanceId: context.method.instanceId,
        condition: context.method.condition,
        draft: context.method.draft,
        installed: context.method.installed,
      },
      environment: context.targetLocation.environment,
      opposition: {
        concealment: context.hiddenMechanics.concealment,
        countermeasure: context.hiddenMechanics.countermeasure,
      },
      operator: { competence: 1 },
      proposedModifiers: modifiers,
    });

    const secret = environment.NOCTURNE_RESOLUTION_SECRET || environment.BETTER_AUTH_SECRET;
    if (!secret) {
      throw new Error("NOCTURNE_RESOLUTION_SECRET or BETTER_AUTH_SECRET is required.");
    }
    const seed = createHmac("sha256", secret)
      .update(
        `${idempotencyKey}:${input.actorId}:${context.method.instanceId}:${context.targetLocation.id}`,
      )
      .digest("hex");

    const resolution = resolveContest({
      actionType: parsed.intent.actionType,
      actorScore: derived.actorScore,
      targetScore: derived.targetScore,
      modifiers: derived.modifiers,
      seed,
      maxModifierTotal: 4,
    });
    resolution.calculationTrace = [...derived.trace, ...resolution.calculationTrace];

    const occurredAt = new Date().toISOString();
    const operations = buildDetectionOperations({
      outcome: resolution.outcomeGrade,
      actorId: input.actorId,
      methodInstanceId: context.method.instanceId,
      targetId: context.hiddenMechanics.targetId,
      occurredAt,
    });
    resolution.stateOperations = operations;
    resolution.narrativeConstraints = [
      "Do not reveal the contact's identity.",
      "Do not claim more certainty than the information asset provides.",
      "Preserve the committed outcome and costs.",
    ];

    let committed: ActionExecutionResponse;
    try {
      committed = await store.commit({
        userId,
        idempotencyKey,
        rawText: input.rawText,
        intent: parsed.intent,
        methodInstanceId: context.method.instanceId,
        targetLocationId: context.targetLocation.id,
        seed,
        actorScore: derived.actorScore,
        targetScore: derived.targetScore,
        resolution,
        operations,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as { code: unknown }).code === "duplicate"
      ) {
        const replay = await store.findByIdempotency(userId, idempotencyKey);
        if (replay) return replay;
      }
      throw error;
    }

    let narration = deterministicNarrationFallback(committed.outcomeGrade);
    if (environment.OPENROUTER_API_KEY) {
      const narrationRun = await store.startAiRun({
        task: "narrate_event",
        authority: "creative",
        requestedModel: "openrouter/free",
        policyVersion: EVENT_NARRATION_POLICY_VERSION,
        inputHash: hash(committed),
        metadata: { eventId: committed.eventId },
      });
      try {
        const result = await narrateCommittedEvent(client, {
          ...committed,
          factsToPreserve: [
            committed.outcomeGrade,
            ...committed.informationGained.map((information) => information.content),
            ...committed.costs.map((cost) => `${cost.resource}:${cost.amount}`),
          ],
          hiddenFactsToExclude: context.hiddenMechanics.hiddenFacts,
        });
        narration = result.data.narration;
        await store.finishAiRun(
          narrationRun,
          result.actualModel,
          result.providerRequestId,
          hash(result.data),
        );
      } catch (error) {
        await store.failAiRun(
          narrationRun,
          error instanceof Error && "code" in error
            ? String((error as { code: unknown }).code)
            : "narration_failed",
        );
      }
    }

    await store.saveNarration(committed.resolutionId, narration);
    return { ...committed, narration };
  }

  return {
    execute,
    list: (userId: string, actorId: string) => store.list(userId, actorId),
  };
}

export type ActionService = ReturnType<typeof createActionService>;
