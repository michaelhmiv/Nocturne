import { z } from "zod";
import {
  NOCTURNE_GAME_CONSTITUTION,
  createAiProviderClientFromEnv,
  planPersistentWorldAction,
  resolveAiProviderConfigFromEnv,
} from "./index.js";

const ContractSchema = z
  .object({
    status: z.literal("ok"),
    capability: z.string().min(1),
  })
  .strict();

const jsonSchema = {
  name: "nocturne_provider_contract",
  description: "Minimal structured-output compatibility probe for the configured provider.",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["status", "capability"],
    properties: {
      status: { const: "ok" },
      capability: { type: "string", minLength: 1 },
    },
  },
} as const;

const configuration = resolveAiProviderConfigFromEnv(process.env);
if (!configuration.apiKey) {
  throw new Error(
    `No API key is configured for provider contract testing (${configuration.provider}).`,
  );
}

const client = createAiProviderClientFromEnv(process.env);
const startedAt = Date.now();
const authoritative = await client.generateStructured({
  task: "parse_intent",
  system: "You are a provider compatibility probe. Return the requested exact status object.",
  prompt: '{"status":"ok","capability":"authoritative-json"}',
  jsonSchema,
  validator: ContractSchema,
});
const creative = await client.generateStructured({
  task: "narrate_event",
  system: "You are a provider compatibility probe. Return the requested exact status object.",
  prompt: '{"status":"ok","capability":"creative-json"}',
  jsonSchema,
  validator: ContractSchema,
});
const actorId = "00000000-0000-4000-8000-000000000101";
const areaId = "00000000-0000-4000-8000-000000000102";
const planner = await planPersistentWorldAction(client, {
  command: "I look around.",
  actorId,
  resolvedEntityIds: [],
  playerKnownFacts: [
    {
      entityId: actorId,
      claim: "entity.location",
      value: areaId,
      confidence: 1,
    },
  ],
  activePlanSummary: null,
  enabledHandlers: [
    "search",
    "move",
    "consume",
    "relationship",
    "combat",
    "transfer",
    "interact",
    "dialogue",
    "question",
  ],
  gameMasterContext: {
    constitution: NOCTURNE_GAME_CONSTITUTION,
    currentCommand: "I look around.",
    currentScene: {
      locationId: areaId,
      locationName: "Provider Contract Room",
      locationDescription: "A deterministic room used for provider compatibility testing.",
      summary: "The actor is standing in the room.",
      unresolvedThreads: [],
    },
    recentTurns: [],
    relevantMemories: [],
    playerKnownFacts: [],
    activePlan: null,
    estimatedTokens: 256,
  },
});

console.log(
  JSON.stringify(
    {
      status: "passed",
      provider: configuration.provider,
      configuredModel: configuration.model,
      authoritativeModel: authoritative.actualModel,
      creativeModel: creative.actualModel,
      plannerModel: planner.actualModel,
      plannerKind: planner.data.primaryKind,
      plannerStepCount: planner.data.plan?.steps.length || 0,
      authoritativeRequestId: authoritative.providerRequestId || null,
      creativeRequestId: creative.providerRequestId || null,
      plannerRequestId: planner.providerRequestId || null,
      durationMs: Date.now() - startedAt,
    },
    null,
    2,
  ),
);
