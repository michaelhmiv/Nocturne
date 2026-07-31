import {
  EntityReferenceInterpretationRequestSchema,
  EntityReferenceInterpretationSchema,
  type EntityReferenceInterpretation,
  type EntityReferenceInterpretationRequest,
} from "@nocturne/contracts";
import { AiProviderClient, type StructuredGenerationResult } from "./ai-provider.js";

export const REFERENCE_INTERPRETATION_POLICY_VERSION = "reference-resolution-v1";

const referenceInterpretationJsonSchema = {
  name: "nocturne_entity_reference_interpretation",
  description:
    "Resolve natural-language entity mentions only against supplied persistent candidates.",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["mentions"],
    properties: {
      mentions: {
        type: "array",
        maxItems: 32,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "order",
            "mentionText",
            "mentionKind",
            "status",
            "candidateEntityIds",
            "confidenceBasisPoints",
            "supportingFactIds",
            "requiresClarification",
            "rationale",
          ],
          properties: {
            order: { type: "integer", minimum: 1, maximum: 32 },
            mentionText: { type: "string" },
            mentionKind: {
              enum: [
                "proper_name",
                "alias",
                "description",
                "pronoun",
                "relationship",
                "location",
                "ordinal",
                "possessive",
                "unknown",
              ],
            },
            status: {
              enum: [
                "resolved",
                "ambiguous",
                "not_found",
                "known_but_inaccessible",
                "known_but_location_unknown",
                "stale_reference",
              ],
            },
            selectedEntityId: { type: "string" },
            candidateEntityIds: { type: "array", maxItems: 12, items: { type: "string" } },
            confidenceBasisPoints: { type: "integer", minimum: 0, maximum: 10000 },
            supportingFactIds: { type: "array", maxItems: 32, items: { type: "string" } },
            requiresClarification: { type: "boolean" },
            clarificationPrompt: { type: "string" },
            rationale: { type: "string" },
          },
        },
      },
    },
  },
} as const;

export function buildReferenceInterpretationPrompt(input: EntityReferenceInterpretationRequest) {
  const parsed = EntityReferenceInterpretationRequestSchema.parse(input);
  return `Identify every entity reference in the player's command and resolve it only against the supplied persistent candidates.

Rules:
- Never invent an entity or ID.
- Do not materialize a new entity. Not-found references remain not_found.
- A noun such as "a dog" may express a search concept rather than reference an existing dog; do not force it onto an unrelated candidate.
- Prefer exact viewpoint-specific aliases, explicit names, physical presence, active relationships, recent salience, and current-plan relevance.
- Pronouns may use recent player-safe text, but not hidden facts.
- Discovery, ownership, possession, control, and physical presence are distinct.
- A dead or retired entity can resolve historically, but mark a stale reference when the command assumes an incompatible current state.
- Use known_but_inaccessible when identity is clear but current access is false.
- Use known_but_location_unknown when identity is clear but location is unknown.
- Use ambiguous and request clarification when multiple candidates remain materially plausible.
- Resolve automatically only when one candidate is clearly dominant and a wrong choice would not silently alter another persistent entity.
- candidateEntityIds, selectedEntityId, and supportingFactIds must come only from supplied candidates.
- Return mentions in textual order. Ignore ordinary nouns that do not refer to a persistent entity.

COMMAND:
${parsed.command}

RECENT PLAYER-SAFE TEXT:
${JSON.stringify(parsed.recentPlayerSafeText)}

PERSISTENT CANDIDATES:
${JSON.stringify(parsed.candidates)}`;
}

export function validateReferenceInterpretation(
  interpretation: EntityReferenceInterpretation,
  input: EntityReferenceInterpretationRequest,
) {
  const parsedInput = EntityReferenceInterpretationRequestSchema.parse(input);
  const parsed = EntityReferenceInterpretationSchema.parse(interpretation);
  const candidates = new Map(
    parsedInput.candidates.map((candidate) => [candidate.entityId, candidate]),
  );
  for (const mention of parsed.mentions) {
    for (const entityId of mention.candidateEntityIds) {
      if (!candidates.has(entityId)) {
        throw new Error("Reference interpretation used an unsupplied candidate entity.");
      }
    }
    for (const factId of mention.supportingFactIds) {
      if (
        !mention.candidateEntityIds.some((entityId) =>
          candidates.get(entityId)?.supportingFactIds.includes(factId),
        )
      ) {
        throw new Error("Reference interpretation cited an unsupported fact.");
      }
    }
    if (mention.status === "resolved") {
      const selected = candidates.get(mention.selectedEntityId!);
      if (!selected) throw new Error("Resolved reference selected an unavailable entity.");
      if (!selected.accessible && mention.confidenceBasisPoints < 9_500) {
        throw new Error(
          "Inaccessible entities require explicit high-confidence identity evidence.",
        );
      }
    }
    if (mention.status === "ambiguous" && mention.candidateEntityIds.length < 2) {
      throw new Error("Ambiguous references require at least two candidates.");
    }
  }
  return parsed;
}

export async function interpretEntityReferences(
  client: Pick<AiProviderClient, "generateStructured">,
  input: EntityReferenceInterpretationRequest,
): Promise<StructuredGenerationResult<EntityReferenceInterpretation>> {
  const parsedInput = EntityReferenceInterpretationRequestSchema.parse(input);
  const result = await client.generateStructured({
    task: "resolve_entity_references",
    system: `You are Nocturne's persistent entity-reference interpreter. Policy ${REFERENCE_INTERPRETATION_POLICY_VERSION}. Resolve language only against supplied candidates. Do not create or mutate world state. Output only the required structured object.`,
    prompt: buildReferenceInterpretationPrompt(parsedInput),
    jsonSchema: referenceInterpretationJsonSchema,
    validator: EntityReferenceInterpretationSchema,
  });
  return {
    ...result,
    data: validateReferenceInterpretation(result.data, parsedInput),
  };
}
