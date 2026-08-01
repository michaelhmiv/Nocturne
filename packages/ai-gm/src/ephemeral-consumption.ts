import { z } from "zod";
import {
  ConsumableAnalysisSchema,
  ConsumptionAnalysisRequestSchema,
  type ActionExecutionResponse,
  type ConsumableAnalysis,
  type ConsumptionAnalysisRequest,
} from "@nocturne/contracts";
import type { AiProviderClient, StructuredGenerationResult } from "./ai-provider.js";
import {
  deriveEphemeralConsumableFallback,
  validateConsumableAnalysisAgainstContext,
} from "./consumable-analyzer.js";

export const EPHEMERAL_CONSUMPTION_POLICY_VERSION = "ephemeral-consumption-v1";

const resourceDelta = {
  type: "object",
  additionalProperties: false,
  required: ["resource", "delta", "rationale"],
  properties: {
    resource: { type: "string" },
    delta: { type: "integer", minimum: -25, maximum: 25 },
    rationale: { type: "string" },
  },
} as const;

const condition = {
  type: "object",
  additionalProperties: false,
  required: ["name", "key", "intensity", "durationSeconds", "rationale"],
  properties: {
    name: { type: "string" },
    key: { type: "string" },
    intensity: { type: "integer", minimum: -10, maximum: 10 },
    durationSeconds: { type: "integer", minimum: 1, maximum: 604800 },
    rationale: { type: "string" },
  },
} as const;

const ephemeralAnalysisJsonSchema = {
  name: "nocturne_ephemeral_consumable_analysis",
  description:
    "Analyze one planner-authorized, low-value environmental substance without materializing durable state.",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "selection",
      "classification",
      "requestedUnits",
      "consumeUnits",
      "resourceDeltas",
      "conditions",
      "risks",
      "narrationFacts",
      "assumptions",
    ],
    properties: {
      selection: {
        type: "object",
        additionalProperties: false,
        required: ["sourceType", "sourceId", "displayName", "rationale", "confidence"],
        properties: {
          sourceType: { const: "ephemeral_environment" },
          sourceId: { type: "string" },
          displayName: { type: "string" },
          rationale: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
      classification: {
        type: "object",
        additionalProperties: false,
        required: [
          "consumable",
          "substanceKind",
          "portionDescription",
          "freshnessAssessment",
          "confidence",
        ],
        properties: {
          consumable: { type: "boolean" },
          substanceKind: { type: "string" },
          portionDescription: { type: "string" },
          freshnessAssessment: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
      requestedUnits: { type: "integer", minimum: 1, maximum: 100 },
      consumeUnits: { type: "integer", minimum: 0, maximum: 5 },
      resourceDeltas: { type: "array", maxItems: 8, items: resourceDelta },
      conditions: { type: "array", maxItems: 6, items: condition },
      risks: {
        type: "array",
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["description", "chanceBasisPoints", "resourceDeltas", "conditions"],
          properties: {
            description: { type: "string" },
            chanceBasisPoints: { type: "integer", minimum: 0, maximum: 10000 },
            resourceDeltas: { type: "array", maxItems: 4, items: resourceDelta },
            conditions: { type: "array", maxItems: 4, items: condition },
          },
        },
      },
      narrationFacts: { type: "array", maxItems: 12, items: { type: "string" } },
      assumptions: { type: "array", maxItems: 8, items: { type: "string" } },
    },
  },
} as const;

export function buildEphemeralConsumptionPrompt(input: ConsumptionAnalysisRequest) {
  const parsed = ConsumptionAnalysisRequestSchema.parse(input);
  const candidate = parsed.candidates.find(
    ({ sourceType }) => sourceType === "ephemeral_environment",
  );
  if (!candidate) throw new Error("Ephemeral analysis requires an ephemeral candidate.");
  return `Analyze the immediate physical consumption of one low-value environmental detail.

The planner has already authorized the detail as plausible ephemeral texture. That authorization proves only that this trivial detail may support the current action. It does not create an item, inventory entry, reusable resource, durable object, or future fact.

Rules:
- Select the supplied ephemeral_environment candidate with its exact sourceId.
- Determine whether the requested physical act can occur. Gum can be chewed; a wall can be licked; an unpleasant substance may be swallowed even when it is not food.
- Consumable means the physical action can occur, not that the substance is nutritious, healthy, edible, or useful.
- Provide no meaningful advantage. Normally use zero nutrition, hydration, energy, healing, or other positive resource deltas.
- Model plausible bounded consequences such as bad taste, disgust, contamination, brief nausea, irritation, or no effect.
- Do not materialize anything and do not imply the detail remains available after the action.
- Do not decide whether probabilistic risks occur. Supply probabilities and bounded effects only.
- Preserve uncertainty about composition and cleanliness.

PLAYER ACTION:
${parsed.rawText}

LOCATION:
${parsed.locationName}
${parsed.locationDescription}

ACTOR STATE:
${JSON.stringify(parsed.actorState)}

EPHEMERAL CANDIDATE:
${JSON.stringify(candidate)}`;
}

export async function analyzeEphemeralConsumption(
  client: Pick<AiProviderClient, "generateStructured">,
  input: ConsumptionAnalysisRequest,
): Promise<StructuredGenerationResult<ConsumableAnalysis>> {
  const parsedInput = ConsumptionAnalysisRequestSchema.parse(input);
  const result = await client.generateStructured({
    task: "analyze_consumable",
    system: `You are Nocturne's ephemeral consumption analyst. Policy ${EPHEMERAL_CONSUMPTION_POLICY_VERSION}. Resolve semantics only within the supplied low-impact authority. Output only the required structured object.`,
    prompt: buildEphemeralConsumptionPrompt(parsedInput),
    jsonSchema: ephemeralAnalysisJsonSchema,
    validator: ConsumableAnalysisSchema,
  });
  const data = validateConsumableAnalysisAgainstContext(result.data, parsedInput);
  if (data.selection.sourceType !== "ephemeral_environment") {
    throw new Error("Ephemeral analysis selected a non-ephemeral source.");
  }
  return { ...result, data };
}

export async function analyzeEphemeralConsumptionResilient(
  client: Pick<AiProviderClient, "generateStructured">,
  input: ConsumptionAnalysisRequest,
): Promise<{
  analysis: ConsumableAnalysis;
  source: "provider" | "deterministic_fallback";
  providerResult?: StructuredGenerationResult<ConsumableAnalysis>;
  providerError?: string;
}> {
  try {
    const providerResult = await analyzeEphemeralConsumption(client, input);
    return { analysis: providerResult.data, source: "provider", providerResult };
  } catch (error) {
    return {
      analysis: validateConsumableAnalysisAgainstContext(
        deriveEphemeralConsumableFallback(input),
        input,
      ),
      source: "deterministic_fallback",
      providerError: error instanceof Error ? error.message : String(error),
    };
  }
}

const EphemeralNarrationSchema = z.object({ narration: z.string().trim().min(1).max(4_000) });
const ephemeralNarrationJsonSchema = {
  name: "nocturne_ephemeral_consumption_narration",
  description: "Player-facing narration for a committed ephemeral consumption event.",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["narration"],
    properties: { narration: { type: "string" } },
  },
} as const;

export function deterministicEphemeralNarration(input: {
  rawText: string;
  displayName: string;
  risks: Array<{ description: string; occurred: boolean }>;
}) {
  const risk = input.risks.find(({ occurred }) => occurred);
  if (/\bgum\b/i.test(`${input.rawText} ${input.displayName}`)) {
    return risk
      ? "You peel the weathered gum from the pole and chew it. It tastes like exhausted mint and municipal neglect, and your stomach immediately questions the decision. You gain no nutrition whatsoever."
      : "You peel the weathered gum from the pole and chew it. It stretches farther than dignity should allow before giving way to a flavor best described as old mint and public infrastructure. You gain no nutrition whatsoever.";
  }
  return risk
    ? `You go through with it and consume ${input.displayName}. It provides no meaningful nourishment, and the committed consequence arrives quickly.`
    : `You go through with it and consume ${input.displayName}. The act succeeds, but it provides no meaningful nourishment or other advantage.`;
}

export async function narrateEphemeralConsumption(
  client: Pick<AiProviderClient, "generateStructured">,
  input: {
    committed: ActionExecutionResponse;
    displayName: string;
    substanceKind: string;
    freshnessAssessment: string;
    narrationFacts: string[];
  },
): Promise<StructuredGenerationResult<{ narration: string }>> {
  const result = await client.generateStructured({
    task: "narrate_event",
    system: `Narrate only the committed ephemeral consumption event. Policy ${EPHEMERAL_CONSUMPTION_POLICY_VERSION}. Be grounded, concise, and entertaining when the action is absurd. Do not add inventory, persistent scenery, travel, mission changes, major injury, death, resources, or risk outcomes that were not committed. Never mention databases, source types, IDs, policies, schemas, or internal mechanics. Refer to the player as "you".`,
    prompt: JSON.stringify({
      rawText: input.committed.rawText,
      outcomeGrade: input.committed.outcomeGrade,
      displayName: input.displayName,
      substanceKind: input.substanceKind,
      freshnessAssessment: input.freshnessAssessment,
      unitsConsumed: input.committed.consumption?.unitsConsumed ?? 0,
      resourceDeltas: input.committed.consumption?.resourceDeltas ?? [],
      conditions: input.committed.consumption?.conditions ?? [],
      risks: input.committed.consumption?.risks ?? [],
      narrationFacts: input.narrationFacts,
    }),
    jsonSchema: ephemeralNarrationJsonSchema,
    validator: EphemeralNarrationSchema,
  });
  return result;
}
