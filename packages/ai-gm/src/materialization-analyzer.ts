import {
  MaterializationAnalysisRequestSchema,
  MaterializationProposalSchema,
  type MaterializationAnalysisRequest,
  type MaterializationProposal,
} from "@nocturne/contracts";
import { AiProviderClient, type StructuredGenerationResult } from "./ai-provider.js";

export const MATERIALIZATION_POLICY_VERSION = "materialization-v1";

const materializationJsonSchema = {
  name: "nocturne_entity_materialization",
  description:
    "A bounded semantic proposal for materializing one persistent entity from an authoritative source.",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "decision",
      "semanticFingerprintBasis",
      "narrationFacts",
      "assumptions",
    ],
    properties: {
      decision: { enum: ["materialize", "reject"] },
      selectedSourceId: { type: "string" },
      rejectionReason: { type: "string" },
      definition: {
        type: "object",
        additionalProperties: false,
        required: ["definitionType", "name", "conceptSummary", "revisionPayload"],
        properties: {
          reuseDefinitionId: { type: "string" },
          definitionType: { type: "string" },
          name: { type: "string" },
          conceptSummary: { type: "string" },
          revisionPayload: { type: "object", additionalProperties: true },
        },
      },
      instance: {
        type: "object",
        additionalProperties: false,
        required: ["displayName", "distinguishingTraits", "condition", "state"],
        properties: {
          displayName: { type: "string" },
          distinguishingTraits: {
            type: "array",
            maxItems: 20,
            items: { type: "string" },
          },
          condition: { type: "integer", minimum: 1, maximum: 100 },
          state: { type: "object", additionalProperties: true },
        },
      },
      semanticFingerprintBasis: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: { type: "string" },
      },
      narrationFacts: {
        type: "array",
        maxItems: 12,
        items: { type: "string" },
      },
      assumptions: {
        type: "array",
        maxItems: 12,
        items: { type: "string" },
      },
    },
  },
} as const;

export function buildMaterializationPrompt(input: MaterializationAnalysisRequest) {
  const parsed = MaterializationAnalysisRequestSchema.parse(input);
  return `Determine whether one persistent entity matching the requested concept may be materialized from the supplied authoritative sources.

No fixed animal, person, item, vehicle, business, or object catalogue exists. Infer open-ended semantics from the requested concept, location, source descriptions, constraints, rarity, and reusable definitions.

Rules:
- The request itself is not evidence that an entity exists.
- Select only an exact supplied source ID.
- Reject when no source has positive capacity or no source plausibly permits the concept.
- Obey every source constraint. Ordinary sources cannot produce exotic, supernatural, rare, extremely valuable, or implausibly abundant entities unless explicitly supported.
- Prefer a supplied reusable definition when its semantics are genuinely compatible. Never select an unsupplied definition ID.
- A reusable definition describes a kind of entity; the instance must still receive unique distinguishing traits and state.
- Do not establish ownership, possession, control, following, trust, hostility, or knowledge. Those are separate world operations.
- Do not resolve whether a search succeeded. This proposal is used only after an authoritative outcome branch permits materialization.
- Do not decide randomness.
- Keep condition and state plausible for the location and source.
- The semanticFingerprintBasis must contain stable identity-relevant traits, not prose about the player request.
- Select decision "reject" instead of inventing unsupported content.

REQUESTED CONCEPT:
${parsed.requestedConcept}

LOCATION:
${parsed.locationName}
${parsed.locationDescription}

WORLD CONTEXT:
${JSON.stringify(parsed.worldContext)}

AUTHORITATIVE MATERIALIZATION SOURCES:
${JSON.stringify(parsed.sourceCandidates)}

REUSABLE DEFINITIONS:
${JSON.stringify(parsed.reusableDefinitions)}`;
}

export function validateMaterializationProposal(
  proposal: MaterializationProposal,
  input: MaterializationAnalysisRequest,
): MaterializationProposal {
  const parsedInput = MaterializationAnalysisRequestSchema.parse(input);
  const parsed = MaterializationProposalSchema.parse(proposal);
  if (parsed.decision === "reject") return parsed;

  const source = parsedInput.sourceCandidates.find(
    (candidate) => candidate.sourceId === parsed.selectedSourceId,
  );
  if (!source) throw new Error("Materialization selected an unavailable authoritative source.");
  if (source.capacity < 1) throw new Error("Materialization selected a depleted source.");

  const reusedDefinitionId = parsed.definition?.reuseDefinitionId;
  if (
    reusedDefinitionId &&
    !parsedInput.reusableDefinitions.some(
      (definition) => definition.definitionId === reusedDefinitionId,
    )
  ) {
    throw new Error("Materialization selected an unavailable reusable definition.");
  }

  if (!parsed.definition || !parsed.instance) {
    throw new Error("Materialization result is missing definition or instance semantics.");
  }

  if (reusedDefinitionId) {
    const reusable = parsedInput.reusableDefinitions.find(
      (definition) => definition.definitionId === reusedDefinitionId,
    )!;
    if (reusable.definitionType !== parsed.definition.definitionType) {
      throw new Error("Reusable definition type does not match the proposed definition type.");
    }
  }

  return MaterializationProposalSchema.parse({
    ...parsed,
    narrationFacts: parsed.narrationFacts.slice(0, 12),
    assumptions: [
      ...parsed.assumptions,
      `Materialization source: ${source.name}.`,
      `Source capacity before commit: ${source.capacity}.`,
    ].slice(-12),
  });
}

export async function analyzeMaterialization(
  client: Pick<AiProviderClient, "generateStructured">,
  input: MaterializationAnalysisRequest,
): Promise<StructuredGenerationResult<MaterializationProposal>> {
  const parsedInput = MaterializationAnalysisRequestSchema.parse(input);
  const result = await client.generateStructured({
    task: "analyze_materialization",
    system: `You are Nocturne's authoritative open-ended materialization analyst. Policy ${MATERIALIZATION_POLICY_VERSION}. You may derive one plausible persistent entity only from supplied authoritative sources. You do not use a fixed content catalogue and you do not mutate world state. Output only the required structured object.`,
    prompt: buildMaterializationPrompt(parsedInput),
    jsonSchema: materializationJsonSchema,
    validator: MaterializationProposalSchema,
  });
  return {
    ...result,
    data: validateMaterializationProposal(result.data, parsedInput),
  };
}
