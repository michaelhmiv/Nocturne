import { createHash, randomUUID } from "node:crypto";
import {
  CONTENT_NORMALIZATION_POLICY_VERSION,
  OpenRouterClient,
  deterministicSurveillanceFallback,
  normalizeGeneratedContent,
} from "@nocturne/ai-gm";
import {
  InstallInventionInputSchema,
  NormalizeContentRequestSchema,
  type InventionSummary,
  type NormalizedContentEnvelope,
} from "@nocturne/contracts";
import { evaluateInstallation, validateGeneratedContent } from "@nocturne/content-engine";
import type { InventionStore } from "@nocturne/database";
import { creationTimeMultiplier, type SkillName } from "@nocturne/rules-engine";

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Deterministic craft difficulty from concept keywords (AI fills this when live). */
function estimateCraftGating(rawConcept: string): {
  primarySkill: SkillName;
  difficulty: number;
  baseBuildSeconds: number;
} {
  const t = rawConcept.toLowerCase();
  if (/chem|drug|acid|explosive|poison/.test(t))
    return { primarySkill: "chemistry", difficulty: 40, baseBuildSeconds: 3600 };
  if (/hack|software|virus|code|ai /.test(t))
    return { primarySkill: "hacking", difficulty: 35, baseBuildSeconds: 1800 };
  if (/gun|blade|weapon|armor|combat/.test(t))
    return { primarySkill: "combat", difficulty: 30, baseBuildSeconds: 2400 };
  if (/engine|motor|vehicle|mech/.test(t))
    return { primarySkill: "mechanics", difficulty: 35, baseBuildSeconds: 4800 };
  if (/circuit|sensor|scan|radio|electronic|camera|surveillance/.test(t))
    return { primarySkill: "electronics", difficulty: 25, baseBuildSeconds: 1200 };
  if (/med|heal|inject|stim/.test(t))
    return { primarySkill: "medicine", difficulty: 30, baseBuildSeconds: 1800 };
  return { primarySkill: "engineering", difficulty: 20, baseBuildSeconds: 900 };
}

export function createInventionService(store: InventionStore, environment = process.env) {
  const client = new OpenRouterClient({
    apiKey: environment.OPENROUTER_API_KEY,
    deepseekApiKey: environment.DEEPSEEK_API_KEY,
    baseUrl: environment.OPENROUTER_BASE_URL,
    httpReferer: environment.OPENROUTER_HTTP_REFERER,
    appName: environment.OPENROUTER_APP_NAME,
  });

  async function normalize(userId: string, rawInput: unknown): Promise<InventionSummary> {
    const input = NormalizeContentRequestSchema.parse(rawInput);
    const requestId = await store.createRequest({
      userId,
      characterId: input.characterId,
      residenceId: input.residenceId,
      rawConcept: input.rawConcept,
      context: { intendedUse: input.intendedUse },
    });
    const runId = await store.startAiRun({
      task: "normalize_content",
      requestedModel: "openrouter/free",
      policyVersion: CONTENT_NORMALIZATION_POLICY_VERSION,
      inputHash: hash(input),
      metadata: { requestId, characterId: input.characterId },
    });
    try {
      let envelope: NormalizedContentEnvelope;
      let actualModel: string;
      let providerRequestId: string | undefined;
      if (
        !environment.OPENROUTER_API_KEY &&
        environment.NOCTURNE_ALLOW_DETERMINISTIC_AI_FALLBACK === "true"
      ) {
        envelope = deterministicSurveillanceFallback(input);
        actualModel = "deterministic-development-fallback";
      } else {
        const result = await normalizeGeneratedContent(client, input);
        envelope = result.data;
        actualModel = result.actualModel;
        providerRequestId = result.providerRequestId;
      }

      const gate = estimateCraftGating(input.rawConcept);
      const level = await store.getCharacterSkillLevel(userId, input.characterId, gate.primarySkill);
      const mult = creationTimeMultiplier(level, gate.difficulty);
      const buildSeconds = Math.round(gate.baseBuildSeconds * mult);
      envelope.draft.extensionPayload = {
        ...envelope.draft.extensionPayload,
        primarySkill: gate.primarySkill,
        creationDifficulty: gate.difficulty,
        skillLevel: level,
        timeMultiplier: mult,
        buildSeconds,
        impractical: mult >= 50,
      };

      const validation = validateGeneratedContent(envelope.draft);
      const capacities = input.residenceId
        ? await store.getResidenceCapacities(userId, input.characterId, input.residenceId)
        : null;
      const installation = capacities ? evaluateInstallation(envelope.draft, capacities) : null;
      await store.finishAiRun(runId, {
        actualModel,
        providerRequestId,
        outputHash: hash(envelope),
      });
      return store.saveNormalization({
        requestId,
        userId,
        draft: envelope.draft,
        validation,
        installation,
      });
    } catch (error) {
      const code =
        error instanceof Error && "code" in error
          ? String((error as { code: unknown }).code)
          : "normalization_failed";
      await Promise.all([store.failAiRun(runId, code), store.markFailed(requestId, userId, code)]);
      throw error;
    }
  }

  async function install(
    userId: string,
    requestId: string,
    rawInput: unknown,
    idempotencyKey?: string,
  ) {
    const input = InstallInventionInputSchema.parse(rawInput);
    const request = await store.getRequest(userId, requestId);
    if (!request.draft) throw new Error("Invention has no normalized definition.");
    const ext = (request.draft.extensionPayload || {}) as Record<string, unknown>;
    // ponytail: buildSeconds is metadata for UI/worker; install remains immediate for now.
    const capacities = await store.getResidenceCapacities(
      userId,
      input.characterId,
      input.residenceId,
    );
    const evaluation = evaluateInstallation(request.draft, capacities);
    const result = await store.install({
      requestId,
      userId,
      characterId: input.characterId,
      residenceId: input.residenceId,
      evaluation,
      idempotencyKey: idempotencyKey || `install:${requestId}:${randomUUID()}`,
    });

    // Schedule craft timer when buildSeconds > 0 (metadata already on draft)
    const buildSeconds = Number(ext.buildSeconds || 0);
    if (buildSeconds > 0 && store.scheduleCraftJob) {
      await store.scheduleCraftJob({
        requestId,
        characterId: input.characterId,
        buildSeconds: Math.min(buildSeconds, 3600), // ponytail: cap 1h in dev
      });
    }

    return {
      ...result,
      craft: {
        primarySkill: ext.primarySkill,
        difficulty: ext.creationDifficulty,
        skillLevel: ext.skillLevel,
        buildSeconds: ext.buildSeconds,
        timeMultiplier: ext.timeMultiplier,
        scheduled: buildSeconds > 0,
      },
    };
  }

  return {
    normalize,
    install,
    list: (userId: string) => store.listRequests(userId),
    get: (userId: string, requestId: string) => store.getRequest(userId, requestId),
  };
}

export type InventionService = ReturnType<typeof createInventionService>;
