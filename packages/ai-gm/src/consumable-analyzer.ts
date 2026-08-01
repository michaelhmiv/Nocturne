import {
  ConsumableAnalysisSchema,
  ConsumptionAnalysisRequestSchema,
  type ConsumableAnalysis,
  type ConsumptionAnalysisRequest,
} from "@nocturne/contracts";
import { AiProviderClient, type StructuredGenerationResult } from "./ai-provider.js";

export const CONSUMABLE_ANALYSIS_POLICY_VERSION = "consumable-analysis-v5";

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
    "Semantic analysis of an arbitrary substance selected from authoritative or provisionally authorized scene candidates.",
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
          sourceType: {
            enum: ["entity", "ambient_pool", "ephemeral_environment", "none"],
          },
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
      materialization: {
        type: "object",
        additionalProperties: false,
        required: ["name", "conceptSummary", "descriptiveTraits", "unitsCreated"],
        properties: {
          name: { type: "string" },
          conceptSummary: { type: "string" },
          descriptiveTraits: { type: "array", items: { type: "string" }, maxItems: 12 },
          unitsCreated: { type: "integer", minimum: 0, maximum: 5 },
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
  return `Resolve the player's consumption request using only the supplied candidates and context.

There is no food catalogue. Infer semantics from each candidate's name, description, state, quantity, access, and constraints. The substance may be ordinary food, a drink, medicine, a drug, poison, a fictional material, or something physically consumed despite providing no nutritional benefit.

Rules:
- Never invent an owned or visible entity.
- Select sourceType "entity" only for an exact supplied entity candidate.
- Select sourceType "ambient_pool" only when the pool can actually materialize a concrete substance matching the request and every constraint.
- Select sourceType "ephemeral_environment" only for the exact supplied request-scoped environmental affordance. Its sourceId is an evidence handle, not a durable entity ID. Do not materialize it, place it in inventory, or imply it persists after this action.
- An ephemeral substance may be physically chewed, licked, tasted, swallowed, or otherwise consumed while providing zero nutrition, hydration, energy, or medical benefit. Consumable means the requested physical act can occur, not that the substance is beneficial or food.
- Ephemeral environmental details must not grant meaningful resources or advantages. Model dirtiness, disgust, contamination, minor illness, or other bounded consequences when plausible.
- Ambient materialization is not permission to satisfy a specific luxury, specialty, rare, prepared, celebratory, or implausibly abundant request unless the pool explicitly supports it.
- Select "none" when no candidate plausibly satisfies the request. Do not select an ambient pool merely to explain why it cannot satisfy the request.
- requestedUnits is the amount the player asked for and must be at least 1. Preserve that request even when availability is insufficient.
- Set consumeUnits to 0 when sourceType is "none" or when a selected source cannot physically be consumed as requested. In those cases return no resource deltas, conditions, or risks.
- Omit materialization unless sourceType is "ambient_pool".
- For a selected consumable source, consumeUnits must be at least 1 and must never exceed the selected candidate's authoritative or provisionally authorized quantity, five units, or materialized units.
- When requestedUnits exceeds consumeUnits but at least one unit can be consumed, state the exact shortfall in assumptions and narrationFacts. Do not turn a quantity shortfall into a total failure.
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

AVAILABLE CANDIDATES:
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
  if (appliedUnits <= 0) {
    return { resourceDeltas: [], conditions: [], risks: [] };
  }
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
  const requestedUnits = parsed.requestedUnits ?? Math.max(1, parsed.consumeUnits);

  if (parsed.selection.sourceType === "none") {
    const fact = `Requested ${requestedUnits} unit${requestedUnits === 1 ? "" : "s"}; no accessible matching source was available, so 0 units were consumed.`;
    return ConsumableAnalysisSchema.parse({
      ...parsed,
      classification: { ...parsed.classification, consumable: false },
      requestedUnits,
      consumeUnits: 0,
      quantityResolution: {
        requestedUnits,
        availableUnits: 0,
        appliedUnits: 0,
        limitedByAvailability: true,
        limitedByEngine: false,
      },
      resourceDeltas: [],
      conditions: [],
      risks: [],
      narrationFacts: [...parsed.narrationFacts, fact].slice(-12),
      assumptions: [
        ...parsed.assumptions,
        "No supplied candidate matched the requested substance.",
      ].slice(-8),
    });
  }

  const candidate = input.candidates.find(
    (value) =>
      value.sourceId === parsed.selection.sourceId &&
      value.sourceType === parsed.selection.sourceType,
  );
  if (!candidate) {
    throw new Error("Consumable analysis selected a source outside the supplied context.");
  }

  const availableUnits = Math.max(0, Math.floor(candidate.quantity ?? 1));
  if (availableUnits < 1) {
    throw new Error("Consumable analysis selected a depleted source.");
  }

  if (parsed.selection.sourceType === "ambient_pool" && !parsed.classification.consumable) {
    const fact = `Requested ${requestedUnits} unit${requestedUnits === 1 ? "" : "s"}; the ambient provisions cannot produce a matching consumable, so 0 units were consumed.`;
    return ConsumableAnalysisSchema.parse({
      ...parsed,
      selection: {
        sourceType: "none",
        displayName: parsed.selection.displayName,
        rationale: parsed.selection.rationale,
        confidence: parsed.selection.confidence,
      },
      classification: { ...parsed.classification, consumable: false },
      requestedUnits,
      consumeUnits: 0,
      quantityResolution: {
        requestedUnits,
        availableUnits: 0,
        appliedUnits: 0,
        limitedByAvailability: true,
        limitedByEngine: false,
      },
      materialization: undefined,
      resourceDeltas: [],
      conditions: [],
      risks: [],
      narrationFacts: [...parsed.narrationFacts, fact].slice(-12),
      assumptions: [
        ...parsed.assumptions,
        "The ambient pool was considered but could not materialize the requested substance.",
      ].slice(-8),
    });
  }

  if (!parsed.classification.consumable) {
    const fact = `Requested ${requestedUnits} unit${requestedUnits === 1 ? "" : "s"}; 0 units were consumed because the selected source cannot be consumed as intended.`;
    return ConsumableAnalysisSchema.parse({
      ...parsed,
      requestedUnits,
      consumeUnits: 0,
      quantityResolution: {
        requestedUnits,
        availableUnits,
        appliedUnits: 0,
        limitedByAvailability: false,
        limitedByEngine: false,
      },
      resourceDeltas: [],
      conditions: [],
      risks: [],
      narrationFacts: [...parsed.narrationFacts, fact].slice(-12),
      assumptions: [
        ...parsed.assumptions,
        "The selected source remains unchanged because no consumption occurred.",
      ].slice(-8),
    });
  }

  const appliedUnits = Math.max(1, Math.min(requestedUnits, availableUnits, 5));
  const limitedByAvailability = requestedUnits > availableUnits;
  const limitedByEngine = requestedUnits > 5;
  const effects = reconcileEffects(parsed, appliedUnits);

  if (parsed.selection.sourceType === "ephemeral_environment") {
    const positiveMagnitude = effects.resourceDeltas.reduce(
      (sum, effect) => sum + Math.max(0, effect.delta),
      0,
    );
    if (positiveMagnitude > 2) {
      throw new Error("Ephemeral environmental consumption cannot grant meaningful resources.");
    }
  }

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
    ? `Availability limits consumption to ${appliedUnits} of ${requestedUnits} requested units.`
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

export function deriveEphemeralConsumableFallback(
  input: ConsumptionAnalysisRequest,
): ConsumableAnalysis {
  const parsedInput = ConsumptionAnalysisRequestSchema.parse(input);
  const candidate = parsedInput.candidates.find(
    ({ sourceType }) => sourceType === "ephemeral_environment",
  );
  if (!candidate)
    throw new Error("Ephemeral consumption fallback requires an ephemeral candidate.");
  const dirty = /\b(?:old|discarded|street|pole|wall|floor|dirty|stale|used|trash|garbage)\b/i.test(
    `${parsedInput.rawText} ${candidate.name} ${candidate.description}`,
  );
  const gum = /\bgum\b/i.test(`${parsedInput.rawText} ${candidate.name}`);
  const canPhysicallyConsume = /\b(?:eat|drink|chew|swallow|lick|taste|consume)\b/i.test(
    parsedInput.rawText,
  );
  return ConsumableAnalysisSchema.parse({
    selection: {
      sourceType: "ephemeral_environment",
      sourceId: candidate.sourceId,
      displayName: candidate.name,
      rationale: "The planner provisionally authorized this low-value environmental detail.",
      confidence: 0.75,
    },
    classification: {
      consumable: canPhysicallyConsume,
      substanceKind: gum ? "discarded chewing gum" : "mundane environmental substance",
      portionDescription: gum ? "one small weathered piece" : "one small incidental amount",
      freshnessAssessment: dirty
        ? "Exposed to the environment and potentially contaminated."
        : "No durable provenance exists; quality is uncertain.",
      confidence: 0.7,
    },
    requestedUnits: 1,
    consumeUnits: canPhysicallyConsume ? 1 : 0,
    quantityResolution: {
      requestedUnits: 1,
      availableUnits: 1,
      appliedUnits: canPhysicallyConsume ? 1 : 0,
      limitedByAvailability: false,
      limitedByEngine: false,
    },
    resourceDeltas: [],
    conditions: [],
    risks:
      dirty && canPhysicallyConsume
        ? [
            {
              description: "Minor contamination or nausea from the exposed substance.",
              chanceBasisPoints: 1000,
              resourceDeltas: [],
              conditions: [
                {
                  name: "Brief nausea",
                  key: "nausea",
                  intensity: -1,
                  durationSeconds: 300,
                  rationale: "The substance was exposed to a dirty public surface.",
                },
              ],
            },
          ]
        : [],
    narrationFacts: [
      `${candidate.name} was an ephemeral environmental detail and was not added to inventory.`,
      "The substance provided no meaningful nutrition, hydration, energy, or medical benefit.",
    ],
    assumptions: [
      "The detail existed only to support this immediate low-impact action.",
      "No durable item or scenery entity was created.",
    ],
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
