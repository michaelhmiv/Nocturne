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

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createInventionService(store: InventionStore, environment = process.env) {
  const client = new OpenRouterClient({
    apiKey: environment.OPENROUTER_API_KEY,
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
    const capacities = await store.getResidenceCapacities(
      userId,
      input.characterId,
      input.residenceId,
    );
    const evaluation = evaluateInstallation(request.draft, capacities);
    return store.install({
      requestId,
      userId,
      characterId: input.characterId,
      residenceId: input.residenceId,
      evaluation,
      idempotencyKey: idempotencyKey || `install:${requestId}:${randomUUID()}`,
    });
  }

  return {
    normalize,
    install,
    list: (userId: string) => store.listRequests(userId),
    get: (userId: string, requestId: string) => store.getRequest(userId, requestId),
  };
}

export type InventionService = ReturnType<typeof createInventionService>;
