import {
  ConsumableAnalysisSchema,
  ConsumptionAnalysisRequestSchema,
  type ConsumableAnalysis,
  type ConsumptionAnalysisRequest,
} from "@nocturne/contracts";
import { AiProviderClient, type StructuredGenerationResult } from "./ai-provider.js";

export const CONSUMABLE_ANALYSIS_POLICY_VERSION = "consumable-analysis-v2";

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
      requestedUnits: { type: "integer", minimum: 1, maximum: 100 },
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
- requestedUnits is the amount the player asked for. Preserve that request even when inventory is insufficient.
- consumeUnits is the amount that can actually be consumed now. It must never exceed the selected candidate's authoritative quantity, five units, or materialized units.
- When requestedUnits exceeds consumeUnits, state the exact shortfall in assumptions and narrationFacts. Do not turn a quantity shortfall into a total failure.
- Ordinary eating and drinking are not medical treatment and do not automatically repair injury.
- Derive bounded resource deltas, temporary conditions, and risks causally from the amount actually consumed. Resource and condition keys are semantic slugs, not catalogue IDs.
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

function scaleInteger(value: number, ratio: number): number {
  if (ratio >= 1 || value === 0) return value;
  const scaled = Math.round(value * ratio);
  if (scaled !== 0) return scaled;
  return value > 0 ? 1 : -1;
}

function reconcileEffects(
  analysis: ConsumableAnalysis,
  appliedUnits: number,
): Pick<ConsumableAnalysis, "resourceDeltas" | "conditions" | "risks"> {
  const modeledUnits = Math.max(1, analysis.consumeUnits);
  const ratio = Math.min(1, appliedUnits / modeledUnits);
  if (ratio >= 1) {
    return {
      resourceDeltas: analysis.resourceDeltas,
      conditions: analysis.conditions,
      risks: analysis.risks,
    };
  }
  return {
    resourceDeltas: analysis.resourceDeltas.map((effect) => ({
      ...effect,
      delta: scaleInteger(effect.delta, ratio),
    })),
    conditions: analysis.conditions.map((effect) => ({
      ...effect,
      intensity: scaleInteger(effect.intensity, ratio),
      durationSeconds: Math.max(1, Math.round(effect.durationSeconds * ratio)),
    })),
    risks: analysis.risks.map((risk) => ({
      ...risk,
      chanceBasisPoints: Math.round(risk.chanceBasisPoints * ratio),
      resourceDeltas: risk.resourceDeltas.map((effect) => ({
        ...effect,
        delta: scaleInteger(effect.delta, ratio),
      })),
      conditions: risk.conditions.map((effect) => ({
        ...effect,
        intensity: scaleInteger(effect.intensity, ratio),
        durationSeconds: Math.max(1, Math.round(effect.durationSeconds * ratio)),
      })),
    })),
  };
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

  const requestedUnits = parsed.requestedUnits ?? parsed.consumeUnits;
  const availableUnits = Math.max(0, Math.floor(candidate.quantity ?? 1));
  if (availableUnits < 1) {
    throw new Error("Consumable analysis selected a depleted authoritative source.");
  }
  const appliedUnits = Math.max(1, Math.min(requestedUnits, availableUnits, 5));
  const limitedByAvailability = requestedUnits > availableUnits;
  const limitedByEngine = requestedUnits > 5;
  const effects = reconcileEffects(parsed, appliedUnits);

  let materialization = parsed.materialization;
  if (materialization) {
    const unitsCreated = Math.max(
      appliedUnits,
      Math.min(materialization.unitsCreated, availableUnits, requestedUnits, 5),
    );
    materialization = { ...materialization, unitsCreated };
  }

  const quantityFact = `Requested ${requestedUnits} unit${requestedUnits === 1 ? "" : "s"}; ${appliedUnits} unit${appliedUnits === 1 ? "" : "s"} can be consumed.`;
  const quantityAssumption = limitedByAvailability
    ? `Authoritative availability limits consumption to ${appliedUnits} of ${requestedUnits} requested units.`
    : limitedByEngine
      ? `The action engine limits one consumption step to ${appliedUnits} of ${requestedUnits} requested units.`
      : `The requested ${requestedUnits} unit${requestedUnits === 1 ? " is" : "s are"} available.`;

  return ConsumableAnalysisSchema.parse({
    ...parsed,
    requestedUnits,
    consumeUnits: appliedUnits,
    quantityResolution: {
      requestedUnits,
      availableUnits,
      appliedUnits,
      limitedByAvailability,
      limitedByEngine,
    },
    materialization,
    ...effects,
    narrationFacts: [...parsed.narrationFacts, quantityFact].slice(-12),
    assumptions: [...parsed.assumptions, quantityAssumption].slice(-8),
  });
}

export async function analyzeConsumable(
  client: AiProviderClient,
  input: ConsumptionAnalysisRequest,
): Promise<StructuredGenerationResult<ConsumableAnalysis>> {
  const parsedInput = ConsumptionAnalysisRequestSchema.parse(input);
  const result = await client.generateStructured({
    task: "analyze_consumable",
    system: `You are Nocturne's authoritative substance and consumption analyst. Policy ${CONSUMABLE_ANALYSIS_POLICY_VERSION}. You infer open-ended semantics from supplied evidence; you do not use or invent a fixed catalogue. Output only the required structured object. The backend remains authoritative for inventory and will reconcile your requested and applied quantities.`,
    prompt: buildConsumableAnalysisPrompt(parsedInput),
    jsonSchema: consumableAnalysisJsonSchema,
    validator: ConsumableAnalysisSchema,
  });
  return { ...result, data: validateConsumableAnalysisAgainstContext(result.data, parsedInput) };
}
