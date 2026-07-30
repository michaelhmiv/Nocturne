import {
  ConsumableAnalysisSchema,
  ConsumptionAnalysisRequestSchema,
  type ConsumableAnalysis,
  type ConsumptionAnalysisRequest,
} from "@nocturne/contracts";
import { OpenRouterClient, type StructuredGenerationResult } from "./openrouter.js";

export const CONSUMABLE_ANALYSIS_POLICY_VERSION = "consumable-analysis-v1";

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

const consumableAnalysisJsonSchema = {
  name: "nocturne_consumable_analysis",
  description:
    "Semantic analysis of an arbitrary substance selected from authoritative scene candidates.",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "selection",
      "classification",
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
        required: ["sourceType", "displayName", "rationale", "confidence"],
        properties: {
          sourceType: { enum: ["entity", "ambient_pool", "none"] },
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
      consumeUnits: { type: "integer", minimum: 1, maximum: 5 },
      materialization: {
        type: "object",
        additionalProperties: false,
        required: ["name", "conceptSummary", "descriptiveTraits", "unitsCreated"],
        properties: {
          name: { type: "string" },
          conceptSummary: { type: "string" },
          descriptiveTraits: { type: "array", items: { type: "string" }, maxItems: 12 },
          unitsCreated: { type: "integer", minimum: 1, maximum: 5 },
        },
      },
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

export function buildConsumableAnalysisPrompt(input: ConsumptionAnalysisRequest): string {
  const parsed = ConsumptionAnalysisRequestSchema.parse(input);
  return `Resolve the player's consumption request using only the supplied authoritative candidates and context.

There is no food catalogue. Infer semantics from each candidate's name, description, state, quantity, access, and constraints. The substance may be ordinary food, a drink, medicine, a drug, poison, a fictional material, or something non-consumable.

Rules:
- Never invent an owned or visible entity.
- Select sourceType "entity" only for an exact supplied entity candidate.
- Select sourceType "ambient_pool" only for an exact supplied ambient pool. You may then materialize one concrete, mundane substance that is plausible under that pool's description and every constraint.
- Ambient materialization is not permission to satisfy a specific luxury, specialty, rare, prepared, or celebratory request unless the pool explicitly supports it.
- Select "none" when no candidate plausibly satisfies the request.
- Ordinary eating and drinking are not medical treatment and do not automatically repair injury.
- Derive bounded resource deltas, temporary conditions, and risks causally from the substance. Resource and condition keys are semantic slugs, not catalogue IDs.
- Do not decide random outcomes. Report risk probabilities and effects; the rules engine resolves them deterministically.
- Cite uncertainty in assumptions rather than pretending unsupported detail is known.

PLAYER REQUEST:
${parsed.rawText}

LOCATION:
${parsed.locationName}
${parsed.locationDescription}

ACTOR STATE:
${JSON.stringify(parsed.actorState)}

AUTHORITATIVE CANDIDATES:
${JSON.stringify(parsed.candidates)}`;
}

export function validateConsumableAnalysisAgainstContext(
  analysis: ConsumableAnalysis,
  input: ConsumptionAnalysisRequest,
): ConsumableAnalysis {
  const parsed = ConsumableAnalysisSchema.parse(analysis);
  if (parsed.selection.sourceType === "none") return parsed;

  const candidate = input.candidates.find(
    (value) =>
      value.sourceId === parsed.selection.sourceId &&
      value.sourceType === parsed.selection.sourceType,
  );
  if (!candidate) {
    throw new Error("Consumable analysis selected a source outside the authoritative context.");
  }
  if (candidate.quantity !== undefined && parsed.consumeUnits > candidate.quantity) {
    throw new Error("Consumable analysis exceeds the available source quantity.");
  }
  if (
    parsed.materialization &&
    (parsed.consumeUnits > parsed.materialization.unitsCreated ||
      parsed.materialization.unitsCreated > (candidate.quantity ?? 5))
  ) {
    throw new Error("Consumable materialization exceeds the ambient resource allowance.");
  }
  return parsed;
}

export async function analyzeConsumable(
  client: OpenRouterClient,
  input: ConsumptionAnalysisRequest,
): Promise<StructuredGenerationResult<ConsumableAnalysis>> {
  const parsedInput = ConsumptionAnalysisRequestSchema.parse(input);
  const result = await client.generateStructured({
    task: "analyze_consumable",
    system: `You are Nocturne's authoritative substance and consumption analyst. Policy ${CONSUMABLE_ANALYSIS_POLICY_VERSION}. You infer open-ended semantics from supplied evidence; you do not use or invent a fixed catalogue. Output only the required structured object.`,
    prompt: buildConsumableAnalysisPrompt(parsedInput),
    jsonSchema: consumableAnalysisJsonSchema,
    validator: ConsumableAnalysisSchema,
  });
  return { ...result, data: validateConsumableAnalysisAgainstContext(result.data, parsedInput) };
}
