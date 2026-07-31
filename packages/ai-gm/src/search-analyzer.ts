import {
  SearchDiscoveryAnalysisRequestSchema,
  SearchDiscoveryAnalysisSchema,
  type SearchDiscoveryAnalysis,
  type SearchDiscoveryAnalysisRequest,
} from "@nocturne/contracts";
import { AiProviderClient, type StructuredGenerationResult } from "./ai-provider.js";

export const SEARCH_DISCOVERY_POLICY_VERSION = "search-discovery-v1";

const searchAnalysisJsonSchema = {
  name: "nocturne_search_discovery_analysis",
  description: "Bounded semantic setup for a deterministic search or discovery contest.",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "targetFamily",
      "requestedConcept",
      "mayMaterialize",
      "actorScore",
      "targetScore",
      "modifiers",
      "successDescription",
      "consequenceDescription",
      "partialDescription",
      "progressDescription",
      "failureDescription",
      "reversalDescription",
      "assumptions",
    ],
    properties: {
      targetFamily: {
        enum: [
          "animal",
          "person",
          "item",
          "entrance",
          "evidence",
          "resource",
          "route",
          "hazard",
          "hidden_space",
          "information",
          "other",
        ],
      },
      requestedConcept: { type: "string" },
      selectedExistingEntityId: { type: "string" },
      mayMaterialize: { type: "boolean" },
      selectedMaterializationSourceId: { type: "string" },
      actorScore: { type: "integer", minimum: -100, maximum: 100 },
      targetScore: { type: "integer", minimum: -100, maximum: 100 },
      modifiers: {
        type: "array",
        maxItems: 16,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["factorId", "value", "reason"],
          properties: {
            factorId: { type: "string" },
            value: { type: "integer", minimum: -5, maximum: 5 },
            reason: { type: "string" },
            sourceId: { type: "string" },
          },
        },
      },
      successDescription: { type: "string" },
      consequenceDescription: { type: "string" },
      partialDescription: { type: "string" },
      progressDescription: { type: "string" },
      failureDescription: { type: "string" },
      reversalDescription: { type: "string" },
      assumptions: { type: "array", maxItems: 16, items: { type: "string" } },
    },
  },
} as const;

export function buildSearchAnalysisPrompt(input: SearchDiscoveryAnalysisRequest) {
  const parsed = SearchDiscoveryAnalysisRequestSchema.parse(input);
  return `Set up one authoritative search or discovery contest. Do not resolve the roll and do not mutate world state.

Rules:
- Search existing supplied entities first. If one matches, select it and set mayMaterialize false.
- Select only supplied existing entity IDs and materialization source IDs.
- Materialization is allowed only when no supplied existing candidate matches and an authoritative source can plausibly support the concept.
- A player asking for something is not evidence that it exists.
- A search can fail even when a source could materialize the concept.
- Derive actor and target scores from supplied facts. Keep modifiers bounded and cite fact/source IDs.
- Do not invent actor skill, equipment, lighting, concealment, population, or access.
- Descriptions must distinguish complete success, success with consequence, partial evidence, failure with progress, clean failure, and catastrophic reversal.
- Finding an entity creates observation/knowledge only. It does not establish ownership, possession, control, trust, or following.
- Do not reveal hidden facts in player-facing descriptions unless the corresponding outcome discovers them.

PLAYER REQUEST:
${parsed.rawText}

SEARCHED AREA:
${parsed.areaName}
${parsed.areaDescription}

REQUESTED CONCEPT:
${parsed.requestedConcept}

ACTOR FACTS:
${JSON.stringify(parsed.actorFacts)}

AREA FACTS:
${JSON.stringify(parsed.areaFacts)}

EXISTING CANDIDATES:
${JSON.stringify(parsed.existingCandidates)}

AUTHORIZED MATERIALIZATION SOURCE IDS:
${JSON.stringify(parsed.materializationSourceIds)}`;
}

export function validateSearchAnalysis(
  analysis: SearchDiscoveryAnalysis,
  input: SearchDiscoveryAnalysisRequest,
) {
  const parsedInput = SearchDiscoveryAnalysisRequestSchema.parse(input);
  const parsed = SearchDiscoveryAnalysisSchema.parse(analysis);
  if (
    parsed.selectedExistingEntityId &&
    !parsedInput.existingCandidates.some(
      ({ entityId }) => entityId === parsed.selectedExistingEntityId,
    )
  ) {
    throw new Error("Search selected an unavailable existing entity.");
  }
  if (
    parsed.selectedMaterializationSourceId &&
    !parsedInput.materializationSourceIds.includes(parsed.selectedMaterializationSourceId)
  ) {
    throw new Error("Search selected an unavailable materialization source.");
  }
  for (const modifier of parsed.modifiers) {
    if (
      modifier.sourceId &&
      ![
        ...parsedInput.existingCandidates.flatMap(({ supportingFactIds }) => supportingFactIds),
        ...parsedInput.materializationSourceIds,
      ].includes(modifier.sourceId)
    ) {
      throw new Error("Search modifier cited an unavailable source.");
    }
  }
  return parsed;
}

export async function analyzeSearchDiscovery(
  client: Pick<AiProviderClient, "generateStructured">,
  input: SearchDiscoveryAnalysisRequest,
): Promise<StructuredGenerationResult<SearchDiscoveryAnalysis>> {
  const parsedInput = SearchDiscoveryAnalysisRequestSchema.parse(input);
  const result = await client.generateStructured({
    task: "analyze_search_discovery",
    system: `You are Nocturne's authoritative search and discovery analyst. Policy ${SEARCH_DISCOVERY_POLICY_VERSION}. You derive bounded contest inputs and outcome semantics from supplied facts. You do not roll, create entities, or mutate state. Output only the required structured object.`,
    prompt: buildSearchAnalysisPrompt(parsedInput),
    jsonSchema: searchAnalysisJsonSchema,
    validator: SearchDiscoveryAnalysisSchema,
  });
  return { ...result, data: validateSearchAnalysis(result.data, parsedInput) };
}
