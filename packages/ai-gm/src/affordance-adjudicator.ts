import {
  AffordanceAssessmentRequestSchema,
  AffordanceAssessmentSchema,
  type AffordanceAssessment,
  type AffordanceAssessmentRequest,
  type WorldActionKind,
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
  /money|currency|weapon|gun|rifle|pistol|ammunition|ammo|key|credential|access card|badge|vehicle|car|medicine|rare|valuable|named person|security|food stockpile|resource/i;
const mundaneEphemeral =
  /gum|dust|lint|pebble|rock|twig|napkin|paper bag|receipt|bottle cap|dead bug|bug|puddle|residue|wrapper|discarded cup|trash|dirt|mud|leaf|leaves/i;
const incidentalFixture =
  /light pole|lamp ?post|pole|wall|floor|ground|sidewalk|windowsill|shelf|curb|street fixture/i;

function terminalIntent(command: string): WorldActionKind | null {
  const text = command.toLowerCase();
  if (/\b(eat|drink|consume|swallow|ingest|chew|taste|lick)\b/.test(text)) return "consume";
  if (/\b(search|look for|find|hunt for|scan for|check for)\b/.test(text)) return "search";
  if (/\b(walk|travel|go to|head to|move to|drive to)\b/.test(text)) return "move";
  if (/\b(attack|punch|strike|fight|shoot|stab)\b/.test(text)) return "combat";
  if (/\b(steal|take from|give|hand|buy|sell|trade|transfer)\b/.test(text)) return "transfer";
  if (/\b(persuade|convince|threaten|bribe|befriend|follow me|come with me)\b/.test(text)) {
    return "relationship";
  }
  if (/\b(ask|talk|say|tell|speak|chat)\b/.test(text)) return "dialogue";
  if (
    /^(who|what|where|when|why|how|is|are|do|does|did|can|could|would|should)\b/.test(text.trim())
  ) {
    return "question";
  }
  if (
    /\b(kick|touch|push|pull|wear|pick up|throw|break|open|close|hide|craft|build|use)\b/.test(text)
  ) {
    return "interact";
  }
  return null;
}

function deterministicAssessment(input: AffordanceAssessmentRequest): AffordanceAssessment | null {
  const intent = terminalIntent(input.command);
  if (!intent || !input.enabledHandlers.includes(intent)) return null;
  const text = input.command;
  const lower = text.toLowerCase();
  const premiseText = lower.replace(
    /^.*?\b(?:eat|drink|consume|swallow|ingest|chew|taste|lick|search|look for|find|hunt for|scan for|check for)\b\s*/,
    "",
  );
  const hasProtectedPremise = protectedAdvantage.test(premiseText);
  const isMundane = mundaneEphemeral.test(premiseText);
  const hasFixture = incidentalFixture.test(premiseText);
  const explicitSearch = intent === "search";

  if (intent === "consume" && (isMundane || hasFixture) && !hasProtectedPremise) {
    const sourceMatch = premiseText.match(
      /(?:off|from|on)\s+(?:an?\s+|the\s+)?(light pole|lamp ?post|pole|wall|floor|ground|sidewalk|windowsill|shelf|curb|street fixture)/i,
    );
    const concept =
      premiseText
        .replace(/\s+(?:off|from|on)\s+(?:an?\s+|the\s+)?.*$/i, "")
        .replace(/^(?:an?\s+|the\s+)/i, "")
        .trim() || "mundane environmental substance";
    const source = sourceMatch?.[1] || "the immediate environment";
    return AffordanceAssessmentSchema.parse({
      terminalIntent: "consume",
      premises: [
        {
          text: concept,
          concept,
          role: "object",
          status: "plausible_ephemeral",
          persistenceReason:
            "The asserted substance is mundane, low-value, immediately consumed, and has no continuing identity.",
          potentialAdvantages: [],
          potentialConsequences: ["unpleasant taste", "minor contamination risk"],
        },
        {
          text: source,
          concept: source,
          role: "source",
          status: "plausible_ephemeral",
          persistenceReason:
            "The generic environmental fixture only supports this immediate action and is not changed by it.",
          potentialAdvantages: [],
          potentialConsequences: [],
        },
      ],
      requiresSearch: false,
      requiresClarification: false,
      rationale:
        "The controlling verb is consumption; the mundane asserted object and generic source are harmless narrative affordances.",
    });
  }

  if (hasProtectedPremise) {
    return AffordanceAssessmentSchema.parse({
      terminalIntent: intent,
      premises: [
        {
          text: premiseText || text,
          concept: premiseText || text,
          role: "object",
          status: "persistent_required",
          persistenceReason:
            "The premise could grant valuable, powerful, identity-bearing, or access-related advantage and requires authoritative support.",
          potentialAdvantages: ["meaningful protected advantage"],
          potentialConsequences: [],
        },
      ],
      requiresSearch: explicitSearch,
      requiresClarification: false,
      rationale:
        "The terminal intent is clear, but the consequential premise cannot be accepted ephemerally.",
    });
  }

  return AffordanceAssessmentSchema.parse({
    terminalIntent: intent,
    premises: [],
    requiresSearch: explicitSearch,
    requiresClarification: false,
    rationale:
      "The command has a clear terminal action and no unsupported ephemeral premise was required.",
  });
}

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
  const deterministic = deterministicAssessment(parsedInput);
  if (deterministic) {
    return {
      data: validateAffordanceAssessment(deterministic, parsedInput),
      requestedModel: "deterministic-affordance-v1",
      actualModel: "deterministic-affordance-v1",
      attempts: 1,
      latencyMs: 0,
    };
  }
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
