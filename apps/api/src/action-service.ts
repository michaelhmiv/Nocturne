import { createHash, createHmac, randomUUID } from "node:crypto";
import {
  ACTION_PARSE_POLICY_VERSION,
  CONSUMABLE_ANALYSIS_POLICY_VERSION,
  DEEPSEEK_FLASH_MODEL,
  EVENT_NARRATION_POLICY_VERSION,
  AiProviderClient,
  analyzeConsumable,
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
import type { ActionStore, ConsumptionStore } from "@nocturne/database";
import {
  ACTION_SKILL,
  applyStanding,
  buildCombatOperations,
  buildDetectionOperations,
  commsNarration,
  deriveDetectionContest,
  factionShift,
  getSkillLevel,
  heatFromCrime,
  legalStatusAfterHeat,
  npcDialogue,
  resolveConsumptionMechanics,
  resolveContest,
  resolveIntercept,
  xpFromOutcome,
  type ActionType,
} from "@nocturne/rules-engine";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

type Pathfinder = {
  findShortestPath: (
    from: string,
    to: string,
    speed?: number,
  ) => Promise<{ path: string[]; totalTimeSeconds: number } | null>;
};

export function createActionService(
  store: ActionStore,
  environment = process.env,
  locations?: Pathfinder | null,
  consumptionStore?: ConsumptionStore | null,
) {
  const pathfind = async (from: string, to: string, speed: number) => {
    if (locations?.findShortestPath) {
      const p = await locations.findShortestPath(from, to, speed);
      if (p) return p;
    }
    return { path: [from, to], totalTimeSeconds: Math.max(1, Math.round(60 / speed)) };
  };

  const client = new AiProviderClient({
      deepseekApiKey: environment.DEEPSEEK_API_KEY,
    });
    const aiConfigured = Boolean(environment.DEEPSEEK_API_KEY);

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
      requestedModel: DEEPSEEK_FLASH_MODEL,
      policyVersion: ACTION_PARSE_POLICY_VERSION,
      inputHash: hash({ input, context: context.publicContext }),
      metadata: { actorId: input.actorId, idempotencyKey },
    });

    try {
      if (
        !environment.DEEPSEEK_API_KEY &&
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
    const actionType = parsed.intent.actionType as ActionType;
    const secret = environment.NOCTURNE_RESOLUTION_SECRET || environment.BETTER_AUTH_SECRET;
    if (!secret) {
      throw new Error("NOCTURNE_RESOLUTION_SECRET or BETTER_AUTH_SECRET is required.");
    }
    const seed = createHmac("sha256", secret)
      .update(
        `${idempotencyKey}:${input.actorId}:${context.method.instanceId}:${context.targetLocation.id}`,
      )
      .digest("hex");

    if (actionType === "consume") {
      if (!consumptionStore) {
        throw new Error("The authoritative consumption store is not configured.");
      }
      if (!aiConfigured) {
        throw new Error("An AI provider is required to resolve open-ended consumable semantics.");
      }

      const consumptionContext = await consumptionStore.buildAnalysisRequest({
        userId,
        actorId: input.actorId,
        rawText: input.rawText,
      });
      const analysisInputHash = hash(consumptionContext);
      const analysisRun = await store.startAiRun({
        task: "analyze_consumable",
        authority: "authoritative",
        requestedModel:
          DEEPSEEK_FLASH_MODEL,
        policyVersion: CONSUMABLE_ANALYSIS_POLICY_VERSION,
        inputHash: analysisInputHash,
        metadata: {
          actorId: input.actorId,
          idempotencyKey,
          candidateCount: consumptionContext.candidates.length,
        },
      });

      let analysis;
      try {
        const result = await analyzeConsumable(client, consumptionContext);
        analysis = result.data;
        await store.finishAiRun(
          analysisRun,
          result.actualModel,
          result.providerRequestId,
          hash(analysis),
        );
      } catch (error) {
        await store.failAiRun(
          analysisRun,
          error instanceof Error && "code" in error
            ? String((error as { code: unknown }).code)
            : "consumable_analysis_failed",
        );
        throw error;
      }

      const mechanics = resolveConsumptionMechanics(analysis, seed);
      let committed: ActionExecutionResponse;
      try {
        committed = await consumptionStore.commitConsumption({
          userId,
          actorId: input.actorId,
          idempotencyKey,
          rawText: input.rawText,
          intent: parsed.intent,
          seed,
          analysis,
          mechanics,
          policyVersion: CONSUMABLE_ANALYSIS_POLICY_VERSION,
          analysisInputHash,
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

      let narration =
        analysis.selection.sourceType === "none"
          ? "You cannot find anything accessible here that matches what you tried to consume."
          : !analysis.classification.consumable
            ? `${analysis.selection.displayName} is not something you can consume as intended.`
            : `You consume ${analysis.selection.displayName}.`;
      if (aiConfigured) {
        const narrationRun = await store.startAiRun({
          task: "narrate_event",
          authority: "creative",
          requestedModel: DEEPSEEK_FLASH_MODEL,
          policyVersion: EVENT_NARRATION_POLICY_VERSION,
          inputHash: hash(committed),
          metadata: { eventId: committed.eventId, actionType: "consume" },
        });
        try {
          const result = await narrateCommittedEvent(client, {
            ...committed,
            factsToPreserve: [
              `outcome:${committed.outcomeGrade}`,
              `substance:${analysis.selection.displayName}`,
              `classification:${analysis.classification.substanceKind}`,
              `freshness:${analysis.classification.freshnessAssessment}`,
              ...analysis.narrationFacts,
              ...mechanics.resourceDeltas.map(
                (effect) => `${effect.resource}:${effect.delta}:${effect.rationale}`,
              ),
              ...mechanics.conditions.map(
                (effect) =>
                  `${effect.name}:${effect.intensity}:${effect.durationSeconds}:${effect.rationale}`,
              ),
              ...mechanics.risks.map(
                (risk) => `${risk.description}:${risk.occurred ? "occurred" : "did_not_occur"}`,
              ),
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

    const skill = ACTION_SKILL[actionType] ?? "investigation";
    if (
      context.method.definitionId &&
      !parsed.intent.methodDefinitionIds.includes(context.method.definitionId)
    ) {
      parsed.intent.methodDefinitionIds = [context.method.definitionId];
    }
    if (!parsed.intent.targetIds.includes(context.targetLocation.id)) {
      parsed.intent.targetIds = [context.targetLocation.id];
    }

    const allowedFacts = new Set(context.publicFacts);
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
      operator: { competence: getSkillLevel(context.actor.state, skill) },
      proposedModifiers: modifiers,
    });

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
    const operations =
      actionType === "attack"
        ? buildCombatOperations({
            outcome: resolution.outcomeGrade,
            actorId: input.actorId,
            targetId: context.hiddenMechanics.targetId,
            occurredAt,
          })
        : buildDetectionOperations({
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

    let dialogue:
      | { speaker: string; line: string; disposition: string }
      | undefined;
    if (actionType === "talk") {
      const npc = await store.findNearbyNpc(input.actorId);
      if (npc) {
        dialogue = npcDialogue({
          npcName: npc.name,
          schedule: npc.schedule,
          rawText: input.rawText,
          outcome: resolution.outcomeGrade,
        });
        resolution.calculationTrace.push(`npc=${npc.name}`);
      }
    }

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
    if (aiConfigured) {
      const narrationRun = await store.startAiRun({
        task: "narrate_event",
        authority: "creative",
        requestedModel: DEEPSEEK_FLASH_MODEL,
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

    const xpGain = xpFromOutcome(committed.outcomeGrade);
    const xp = await store.applyActorSkillXp(input.actorId, skill, xpGain);
    if (xp) {
      committed.calculationTrace = [
        ...committed.calculationTrace,
        `xp_${skill}=+${xpGain}`,
        `skill_${skill}_level=${xp.level}${xp.leveledUp ? " (level up)" : ""}`,
      ];
    }
    if (actionType === "attack" && committed.outcomeGrade === "catastrophic_reversal") {
      const dropped = await store.stripCarriedOnDeath(input.actorId);
      committed.calculationTrace = [
        ...committed.calculationTrace,
        `death_strip_items=${dropped}`,
      ];
    }

    let payday: { paidCents: number; cashOnPerson: number } | undefined;
    if (actionType === "work") {
      const mult =
        committed.outcomeGrade === "complete_success"
          ? 1.5
          : committed.outcomeGrade === "failure" ||
              committed.outcomeGrade === "catastrophic_reversal"
            ? 0.4
            : 1;
      const paidCents = Math.max(100, Math.round(1500 * mult));
      const st = await store.readActorState(input.actorId);
      const cash = Number(st.cashOnPerson || 0) + paidCents;
      await store.patchActorState(input.actorId, { cashOnPerson: cash });
      payday = { paidCents, cashOnPerson: cash };
      committed.calculationTrace.push(`payday=+${paidCents}`, `cash=${cash}`);
      narration = `Gig pays $${(paidCents / 100).toFixed(2)}. Cash on hand: $${(
        cash / 100
      ).toFixed(2)}.\n\n${narration}`;
    }

    let travel:
      | { to: string; path: string[]; travelSeconds: number; scheduled: boolean }
      | undefined;
    if (actionType === "move" || actionType === "drive") {
      const from = (await store.getActorLocation(input.actorId)) || context.targetLocation.id;
      const destHint =
        /(?:to|toward|into)\s+([a-z0-9 .'/-]{3,40})/i.exec(input.rawText)?.[1] || "alley";
      const dest =
        (await store.resolvePlaceByName(destHint)) || {
          id: context.targetLocation.id,
          name: context.targetLocation.name,
        };
      const speed = await store.getOwnedVehicleSpeed(input.actorId);
      const route = await pathfind(from, dest.id, speed);
      const travelSeconds = route.totalTimeSeconds;
      if (travelSeconds <= 5) {
        await store.moveActor(input.actorId, dest.id);
        travel = { to: dest.id, path: route.path, travelSeconds, scheduled: false };
      } else {
        const arrives = new Date(Date.now() + travelSeconds * 1000);
        await store.scheduleJob({
          kind: "move",
          resolvesAt: arrives,
          payload: { actorId: input.actorId, locationId: dest.id, path: route.path },
          intentId: committed.intentId,
        });
        travel = { to: dest.id, path: route.path, travelSeconds, scheduled: true };
      }
      committed.calculationTrace = [
        ...committed.calculationTrace,
        `travel_to=${dest.name}`,
        `travel_seconds=${travelSeconds}`,
        `speed_factor=${speed}`,
      ];
      narration = travel.scheduled
        ? `You set out for ${dest.name}. ETA ~${travelSeconds}s.\n\n${narration}`
        : `You arrive at ${dest.name}.\n\n${narration}`;
    }

    let legal:
      | { heat: number; warrant: boolean; jailed: boolean; jailSeconds: number }
      | undefined;
    const heatGain = heatFromCrime(actionType, committed.outcomeGrade);
    if (heatGain > 0) {
      const st = await store.readActorState(input.actorId);
      const prevHeat = Number(st.heat || 0);
      const status = legalStatusAfterHeat(prevHeat + heatGain, Boolean(st.warrant));
      await store.patchActorState(input.actorId, {
        heat: status.heat,
        warrant: status.warrant,
        status: status.jailed ? "jailed" : st.status || "active",
      });
      if (status.jailed && status.jailSeconds > 0) {
        await store.scheduleJob({
          kind: "jail_release",
          resolvesAt: new Date(Date.now() + status.jailSeconds * 1000),
          payload: { actorId: input.actorId },
        });
      }
      legal = status;
      committed.calculationTrace = [
        ...committed.calculationTrace,
        `heat=+${heatGain}`,
        `heat_total=${status.heat}`,
        status.warrant ? "warrant=true" : "warrant=false",
        status.jailed ? `jailed=${status.jailSeconds}s` : "jailed=false",
      ];
      if (status.jailed) {
        narration = `Sirens. You're cuffed and hauled in (${status.jailSeconds}s).\n\n${narration}`;
      } else if (status.warrant) {
        narration = `Your heat draws a warrant.\n\n${narration}`;
      }
    }

    const fDelta = factionShift(actionType);
    let standing: Record<string, number> | undefined;
    if (Object.keys(fDelta).length) {
      const st = await store.readActorState(input.actorId);
      const prev = (st.factionStanding as Record<string, number>) || {};
      standing = applyStanding(prev, fDelta);
      await store.patchActorState(input.actorId, { factionStanding: standing });
      committed.calculationTrace.push(
        `faction=${Object.entries(fDelta)
          .map(([k, v]) => `${k}:${v > 0 ? "+" : ""}${v}`)
          .join(",")}`,
      );
    }

    let comms:
      | { toName: string; intercepted: boolean; chance: number; messageId: string }
      | undefined;
    if (/message|text|call|radio|ping/i.test(input.rawText)) {
      const st = await store.readActorState(input.actorId);
      const heat = Number(st.heat || 0);
      const roll = parseInt(seed.slice(0, 8), 16) / 0xffffffff;
      const { intercepted, chance } = resolveIntercept(
        heat,
        committed.outcomeGrade,
        roll,
      );
      const toName =
        /(?:to|call)\s+([A-Za-z][A-Za-z0-9 _-]{1,30})/i.exec(input.rawText)?.[1]?.trim() ||
        "Unknown";
      const body = input.rawText.slice(0, 400);
      const msg = await store.sendComms({
        fromId: input.actorId,
        toName,
        body,
        intercepted,
        chance,
      });
      comms = {
        toName,
        intercepted,
        chance,
        messageId: msg.messageId,
      };
      narration = `${commsNarration({ toName, body, intercepted })}\n\n${narration}`;
      committed.calculationTrace.push(
        `comms_intercept=${intercepted}`,
        `comms_chance=${chance.toFixed(2)}`,
      );
    }

    if (dialogue) {
      narration = `${dialogue.line}\n\n${narration}`;
    }
    await store.saveNarration(committed.resolutionId, narration);

    return {
      ...committed,
      narration,
      ...(dialogue ? { dialogue } : {}),
      ...(xp ? { skillProgress: { skill, ...xp, xpGain } } : {}),
      ...(travel ? { travel } : {}),
      ...(legal ? { legal } : {}),
      ...(standing ? { factionStanding: standing } : {}),
      ...(comms ? { comms } : {}),
      ...(payday ? { payday } : {}),
    } as ActionExecutionResponse;
  }

  return {
    execute,
    list: (userId: string, actorId: string) => store.list(userId, actorId),
    listComms: (actorId: string) => store.listComms(actorId),
  };
}

export type ActionService = ReturnType<typeof createActionService>;
