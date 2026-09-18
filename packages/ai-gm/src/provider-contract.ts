import { z } from "zod";
import {
  NOCTURNE_GAME_CONSTITUTION,
  createAiDecisionClientFromEnv,
  createAiProviderClientFromEnv,
  planPersistentWorldAction,
  resolveAiDecisionConfigFromEnv,
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
const decisionConfiguration = resolveAiDecisionConfigFromEnv(process.env);
if (!configuration.apiKey || !decisionConfiguration.apiKey) {
  throw new Error(
    "OpenRouter credentials are required for Jev + generative provider contract testing.",
  );
}

const client = createAiProviderClientFromEnv(process.env);
const decisionClient = createAiDecisionClientFromEnv(process.env);
const startedAt = Date.now();
const decision = await decisionClient.decide({
  task: "provider_contract_decision",
  state: {
    command: "open the door",
    fact: "The door is directly in front of the actor and unlocked.",
  },
  questions: {
    intent: {
      type: "choice",
      instructions: "What kind of action is the actor attempting?",
      criteria: {
        interact: "A physical interaction with an object.",
        dialogue: "Speaking or communicating.",
      },
    },
    permitted_attempt: {
      type: "noul",
      instructions: "Do the supplied facts permit the actor to attempt opening the door?",
      criteria: {
        true: "The required object and access are present.",
        false: "A required object or access prerequisite is absent.",
      },
    },
  },
});
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
      decisionModel: decision.actualModel,
      decisionIntent: decision.answers.intent.choice,
      decisionPermittedAttempt: decision.answers.permitted_attempt.noul,
      decisionLatencyMs: decision.latencyMs,
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
