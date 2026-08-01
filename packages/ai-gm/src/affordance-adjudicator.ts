import {
  AffordanceAssessmentRequestSchema,
  AffordanceAssessmentSchema,
  type AffordanceAssessment,
  type AffordanceAssessmentRequest,
} from "@nocturne/contracts";
import { AiProviderClient, type StructuredGenerationResult } from "./ai-provider.js";
import { buildGameConstitutionPrompt } from "./game-constitution.js";

export const AFFORDANCE_ASSESSMENT_POLICY_VERSION = "affordance-assessment-v1";

const assessmentJsonSchema = {
  name: "nocturne_affordance_assessment",
  description:
    "Identify terminal player intent and classify asserted world details by persistence and authority requirements.",
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "terminalIntent",
      "premises",
      "requiresSearch",
      "requiresClarification",
      "rationale",
    ],
    properties: {
      terminalIntent: {
        enum: [
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
      },
      premises: {
        type: "array",
        maxItems: 24,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "text",
            "concept",
            "role",
            "status",
            "persistenceReason",
            "potentialAdvantages",
            "potentialConsequences",
          ],
          properties: {
            text: { type: "string" },
            concept: { type: "string" },
            role: {
              enum: ["subject", "object", "source", "method", "location", "incidental"],
            },
            status: {
              enum: [
                "established",
                "plausible_ephemeral",
                "scene_local",
                "persistent_required",
                "contradictory",
                "uncertain",
              ],
            },
            persistenceReason: { type: "string" },
            potentialAdvantages: {
              type: "array",
              maxItems: 8,
              items: { type: "string" },
            },
            potentialConsequences: {
              type: "array",
              maxItems: 8,
              items: { type: "string" },
            },
          },
        },
      },
      requiresSearch: { type: "boolean" },
      requiresClarification: { type: "boolean" },
      clarificationPrompt: { type: "string" },
      rationale: { type: "string" },
    },
  },
} as const;

const protectedAdvantage =
  /money|currency|weapon|ammunition|ammo|key|credential|access|vehicle|medicine|rare|valuable|named person|security|food stockpile|resource/i;

export function buildAffordanceAssessmentPrompt(input: AffordanceAssessmentRequest): string {
  const parsed = AffordanceAssessmentRequestSchema.parse(input);
  return `${buildGameConstitutionPrompt()}

TASK
Determine the player's terminal intent and classify every asserted or implied premise. This stage does not decide outcomes or mutate state.

Rules:
- The terminal intent is the action the player ultimately wants completed. Supporting motions, acquisition, incidental scenery, and source descriptions do not replace it.
- When a player directly asserts a mundane, low-value environmental detail as part of an immediate action, accept it as plausible_ephemeral unless it contradicts established facts or creates meaningful advantage.
- Do not require a search merely to prove an asserted harmless detail such as ordinary litter, dust, a pebble, a puddle, a generic fixture, or old gum.
- Use scene_local only when the detail is likely to matter for follow-up actions in the current scene.
- Use persistent_required for identity-bearing, valuable, powerful, unique, possessed, damaged, moved, scheduled, criminal-evidence, travel-relevant, relationship-relevant, or otherwise causally durable things.
- Currency, weapons, ammunition, keys, credentials, vehicles, named people, rare medicine, substantial resources, and security access can never be plausible_ephemeral.
- requiresSearch means the player's terminal intent is actually to search, or a materially consequential premise remains uncertain. It is not a prerequisite for harmless asserted texture.
- Request clarification only when the terminal action cannot be safely or coherently identified.

COMMAND:
${parsed.command}

CURRENT SCENE:
${JSON.stringify(parsed.currentScene)}

RECENT TURNS:
${JSON.stringify(parsed.recentTurns)}

PLAYER-KNOWN FACTS:
${JSON.stringify(parsed.playerKnownFacts)}

ENABLED HANDLERS:
${JSON.stringify(parsed.enabledHandlers)}`;
}

export function validateAffordanceAssessment(
  assessment: AffordanceAssessment,
  input: AffordanceAssessmentRequest,
): AffordanceAssessment {
  const parsedInput = AffordanceAssessmentRequestSchema.parse(input);
  const parsed = AffordanceAssessmentSchema.parse(assessment);
  if (!parsedInput.enabledHandlers.includes(parsed.terminalIntent)) {
    throw new Error("Affordance assessment selected a disabled terminal handler.");
  }
  return AffordanceAssessmentSchema.parse({
    ...parsed,
    premises: parsed.premises.map((premise) => {
      const meaningfulAdvantage = premise.potentialAdvantages.some((value) =>
        protectedAdvantage.test(value),
      );
      if (premise.status === "plausible_ephemeral" && meaningfulAdvantage) {
        return {
          ...premise,
          status: "persistent_required" as const,
          persistenceReason: `${premise.persistenceReason} Backend policy requires authority because the premise could grant a meaningful advantage.`,
        };
      }
      return premise;
    }),
  });
}

export async function assessAffordances(
  client: Pick<AiProviderClient, "generateStructured">,
  input: AffordanceAssessmentRequest,
): Promise<StructuredGenerationResult<AffordanceAssessment>> {
  const parsedInput = AffordanceAssessmentRequestSchema.parse(input);
  const result = await client.generateStructured(
    {
      task: "assess_affordances",
      system: `You are Nocturne's terminal-intent and persistence adjudicator. Policy ${AFFORDANCE_ASSESSMENT_POLICY_VERSION}. Preserve player creativity without granting unsupported durable advantage. Output only the required structured object.`,
      prompt: buildAffordanceAssessmentPrompt(parsedInput),
      jsonSchema: assessmentJsonSchema,
      validator: AffordanceAssessmentSchema,
    },
    2,
  );
  return { ...result, data: validateAffordanceAssessment(result.data, parsedInput) };
}
