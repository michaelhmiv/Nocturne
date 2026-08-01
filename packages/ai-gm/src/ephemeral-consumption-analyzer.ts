import {
  EphemeralConsumptionAnalysisRequestSchema,
  EphemeralConsumptionAnalysisSchema,
  type EphemeralConsumptionAnalysis,
  type EphemeralConsumptionAnalysisRequest,
} from "@nocturne/contracts";
import { AiProviderClient, type StructuredGenerationResult } from "./ai-provider.js";
import { buildGameConstitutionPrompt } from "./game-constitution.js";

export const EPHEMERAL_CONSUMPTION_POLICY_VERSION = "ephemeral-consumption-v1";

const deltaSchema = {
  type: "object",
  additionalProperties: false,
  required: ["resource", "delta", "rationale"],
  properties: {
    resource: { type: "string" },
    delta: { type: "integer", minimum: -10, maximum: 10 },
    rationale: { type: "string" },
  },
} as const;

const analysisJsonSchema = {
  name: "nocturne_ephemeral_consumption",
  description:
    "Analyze a low-value environmental substance that exists only to support the immediate action.",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "displayName",
      "substanceKind",
      "portionDescription",
      "plausibility",
      "consumable",
      "nutritionValue",
      "hydrationValue",
      "resourceDeltas",
      "conditions",
      "contaminationRiskBasisPoints",
      "contaminationEffects",
      "narrationFacts",
      "rationale",
    ],
    properties: {
      displayName: { type: "string" },
      substanceKind: { type: "string" },
      portionDescription: { type: "string" },
      plausibility: { enum: ["ordinary", "unusual_but_plausible", "implausible"] },
      consumable: { type: "boolean" },
      nutritionValue: { enum: ["none", "negligible", "minor"] },
      hydrationValue: { enum: ["none", "negligible", "minor"] },
      resourceDeltas: { type: "array", maxItems: 6, items: deltaSchema },
      conditions: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "key", "intensity", "durationSeconds", "rationale"],
          properties: {
            name: { type: "string" },
            key: { type: "string" },
            intensity: { type: "integer", minimum: -5, maximum: 5 },
            durationSeconds: { type: "integer", minimum: 1, maximum: 86400 },
            rationale: { type: "string" },
          },
        },
      },
      contaminationRiskBasisPoints: { type: "integer", minimum: 0, maximum: 5000 },
      contaminationEffects: { type: "array", maxItems: 4, items: deltaSchema },
      narrationFacts: { type: "array", maxItems: 12, items: { type: "string" } },
      rationale: { type: "string" },
    },
  },
} as const;

export function buildEphemeralConsumptionPrompt(input: EphemeralConsumptionAnalysisRequest) {
  const parsed = EphemeralConsumptionAnalysisRequestSchema.parse(input);
  return `${buildGameConstitutionPrompt()}

TASK
Analyze one immediate environmental consumption action. The described substance and incidental source are narrative affordances, not durable inventory. Infer modest effects from ordinary real-world semantics while preserving uncertainty.

Rules:
- This path is only for mundane, low-value, immediately consumed material that grants no meaningful advantage.
- Do not create inventory, ownership, currency, weapons, credentials, access, medicine, substantial nourishment, or durable entities.
- A foolish or disgusting action may still be consumable and complete successfully as an action.
- Nutrition and hydration must usually be none or negligible. Minor is the absolute ceiling.
- Do not award positive satiety when nutritionValue is none, or positive hydration when hydrationValue is none.
- Represent contamination as a bounded risk rather than a guaranteed injury unless the described material makes immediate harm unavoidable.
- Do not decide whether probabilistic contamination occurs. The backend resolves it deterministically.
- narrationFacts must describe only facts the narrator may safely preserve.

PLAYER ACTION:
${parsed.rawText}

SUBSTANCE CONCEPT:
${parsed.concept}

INCIDENTAL SOURCE:
${parsed.sourceDescription}

LOCATION:
${parsed.locationName}
${parsed.locationDescription}

RECENT TURNS:
${JSON.stringify(parsed.recentTurns)}`;
}

export function validateEphemeralConsumptionAnalysis(
  analysis: EphemeralConsumptionAnalysis,
): EphemeralConsumptionAnalysis {
  const parsed = EphemeralConsumptionAnalysisSchema.parse(analysis);
  const allowedPositive = new Set<string>();
  if (parsed.nutritionValue !== "none") allowedPositive.add("satiety");
  if (parsed.hydrationValue !== "none") allowedPositive.add("hydration");
  return EphemeralConsumptionAnalysisSchema.parse({
    ...parsed,
    resourceDeltas: parsed.resourceDeltas.map((delta) =>
      delta.delta > 0 && !allowedPositive.has(delta.resource) ? { ...delta, delta: 0 } : delta,
    ),
  });
}

export async function analyzeEphemeralConsumption(
  client: Pick<AiProviderClient, "generateStructured">,
  input: EphemeralConsumptionAnalysisRequest,
): Promise<StructuredGenerationResult<EphemeralConsumptionAnalysis>> {
  const parsedInput = EphemeralConsumptionAnalysisRequestSchema.parse(input);
  const result = await client.generateStructured(
    {
      task: "analyze_ephemeral_consumption",
      system: `You are Nocturne's bounded environmental-consumption analyst. Policy ${EPHEMERAL_CONSUMPTION_POLICY_VERSION}. You describe trivial immediate mechanics without creating durable state. Output only the required structured object.`,
      prompt: buildEphemeralConsumptionPrompt(parsedInput),
      jsonSchema: analysisJsonSchema,
      validator: EphemeralConsumptionAnalysisSchema,
    },
    2,
  );
  return { ...result, data: validateEphemeralConsumptionAnalysis(result.data) };
}
