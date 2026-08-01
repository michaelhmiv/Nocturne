import {
  AffordanceAssessmentRequestSchema,
  AffordanceAssessmentSchema,
  type AffordanceAssessment,
  type AffordanceAssessmentRequest,
  type AffordanceAdvantageCategory,
  type WorldActionKind,
} from "@nocturne/contracts";
import { AiProviderClient, type StructuredGenerationResult } from "./ai-provider.js";
import { buildGameConstitutionPrompt } from "./game-constitution.js";

export const AFFORDANCE_ASSESSMENT_POLICY_VERSION = "affordance-assessment-v2";

const assessmentJsonSchema = {
  name: "nocturne_environmental_affordance_assessment",
  description:
    "Identify terminal player intent and classify asserted environmental premises by persistence and authority requirements.",
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
        maxItems: 32,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "text",
            "concept",
            "role",
            "status",
            "persistenceReason",
            "advantageCategories",
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
            advantageCategories: {
              type: "array",
              minItems: 1,
              maxItems: 12,
              items: {
                enum: [
                  "none",
                  "currency",
                  "weapon",
                  "ammunition",
                  "credential",
                  "key",
                  "vehicle",
                  "named_person",
                  "rare_medicine",
                  "major_resource",
                  "security_access",
                  "high_value_item",
                ],
              },
            },
            potentialConsequences: {
              type: "array",
              maxItems: 16,
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

const highImpactSignals: Array<[RegExp, AffordanceAdvantageCategory]> = [
  [/\b(?:cash|money|dollars?|wallet full|gold bars?|briefcase of money)\b/i, "currency"],
  [/\b(?:gun|rifle|pistol|shotgun|sword|explosive|grenade)\b/i, "weapon"],
  [/\b(?:ammo|ammunition|bullets?|shells?)\b/i, "ammunition"],
  [/\b(?:badge|credential|password|passcode|access card)\b/i, "credential"],
  [/\b(?:master key|keycard|keys? to)\b/i, "key"],
  [/\b(?:car|truck|motorcycle|helicopter|aircraft|boat)\b/i, "vehicle"],
  [/\b(?:mayor|president|governor|chief|celebrity|named person)\b/i, "named_person"],
  [/\b(?:rare medicine|antidote|prescription|experimental drug)\b/i, "rare_medicine"],
  [/\b(?:warehouse full|stockpile|crate of|unlimited|massive supply)\b/i, "major_resource"],
  [/\b(?:security access|bypass security|unlock everything|admin access)\b/i, "security_access"],
  [/\b(?:diamond|jewelry|valuable artifact|priceless|expensive watch)\b/i, "high_value_item"],
];

export function detectedAdvantageCategories(text: string) {
  return highImpactSignals
    .filter(([pattern]) => pattern.test(text))
    .map(([, category]) => category);
}

function inferTerminalIntent(command: string, enabledHandlers: WorldActionKind[]): WorldActionKind {
  const candidates: Array<[RegExp, WorldActionKind]> = [
    [/\b(?:look for|search|find|scan|inspect for)\b/i, "search"],
    [/\b(?:eat|drink|chew|swallow|lick|taste|consume)\b/i, "consume"],
    [/\b(?:attack|punch|shoot|stab|fight|strike)\b/i, "combat"],
    [/\b(?:walk|run|go|travel|drive|move to|head to)\b/i, "move"],
    [/\b(?:give|hand|transfer|trade|steal|take possession)\b/i, "transfer"],
    [/\b(?:befriend|follow|trust|adopt|recruit|accompany)\b/i, "relationship"],
    [/\b(?:say|tell|speak|talk|shout|whisper)\b/i, "dialogue"],
    [/^(?:who|what|where|when|why|how|is|are|can|do)\b|\?$/i, "question"],
  ];
  for (const [pattern, kind] of candidates) {
    if (pattern.test(command) && enabledHandlers.includes(kind)) return kind;
  }
  return enabledHandlers.includes("interact") ? "interact" : enabledHandlers[0]!;
}

export function deriveConservativeAffordanceAssessment(
  input: AffordanceAssessmentRequest,
): AffordanceAssessment {
  const parsed = AffordanceAssessmentRequestSchema.parse(input);
  const terminalIntent = inferTerminalIntent(parsed.command, parsed.enabledHandlers);
  const advantages = detectedAdvantageCategories(parsed.command);
  const premises: AffordanceAssessment["premises"] = [];

  if (/\bgum\b/i.test(parsed.command)) {
    premises.push({
      text: "gum",
      concept: "old chewing gum",
      role: "object",
      status: advantages.length ? "persistent_required" : "plausible_ephemeral",
      persistenceReason: advantages.length
        ? "The premise could grant an advantage and requires authority."
        : "The low-value detail is consumed immediately and has no durable identity.",
      advantageCategories: advantages.length ? advantages : ["none"],
      potentialConsequences: ["unpleasant taste", "minor contamination risk"],
    });
  }
  if (/\b(?:light pole|lamp post|lamppost)\b/i.test(parsed.command)) {
    premises.push({
      text: "light pole",
      concept: "generic municipal light pole",
      role: "source",
      status: advantages.length ? "persistent_required" : "plausible_ephemeral",
      persistenceReason: advantages.length
        ? "The asserted source is tied to an advantage-bearing premise."
        : "The fixture is incidental scenery and is not changed by the action.",
      advantageCategories: advantages.length ? advantages : ["none"],
      potentialConsequences: [],
    });
  }
  if (advantages.length && premises.length === 0) {
    premises.push({
      text: parsed.command,
      concept: "advantage-bearing asserted premise",
      role: "object",
      status: "persistent_required",
      persistenceReason: "High-impact or identity-bearing details require authoritative support.",
      advantageCategories: advantages,
      potentialConsequences: ["unauthorized advantage if accepted without authority"],
    });
  }

  return AffordanceAssessmentSchema.parse({
    terminalIntent,
    premises,
    requiresSearch: terminalIntent === "search" || advantages.length > 0,
    requiresClarification: false,
    rationale:
      advantages.length > 0
        ? "Conservative fallback requires authoritative support for the asserted advantage."
        : "Conservative fallback preserves the terminal verb and permits only low-impact texture.",
  });
}

export function validateAffordanceAssessment(
  assessment: AffordanceAssessment,
  input: AffordanceAssessmentRequest,
) {
  const parsedInput = AffordanceAssessmentRequestSchema.parse(input);
  const parsed = AffordanceAssessmentSchema.parse(assessment);
  if (!parsedInput.enabledHandlers.includes(parsed.terminalIntent)) {
    throw new Error("Affordance adjudicator selected a disabled terminal intent.");
  }
  for (const premise of parsed.premises) {
    const detected = detectedAdvantageCategories(`${premise.text} ${premise.concept}`);
    if (["plausible_ephemeral", "scene_local"].includes(premise.status) && detected.length > 0) {
      throw new Error(
        `High-impact premise cannot be improvised as ${premise.status}: ${detected.join(", ")}.`,
      );
    }
  }
  return parsed;
}

export function buildAffordanceAssessmentPrompt(input: AffordanceAssessmentRequest) {
  const parsed = AffordanceAssessmentRequestSchema.parse(input);
  return `${buildGameConstitutionPrompt(parsed.gameMasterContext.constitution)}

Assess the player's asserted premises before action planning.

Instructions:
- Identify the terminal intent: the action the player ultimately means to perform. Supporting motions and incidental source descriptions do not replace it.
- Treat the player's direct assertion of a mundane, plausible, low-value detail as provisionally available when it contradicts no established fact and grants no meaningful advantage.
- Use plausible_ephemeral for details needed only for this immediate resolution.
- Use scene_local when the detail may matter again within the current scene.
- Use persistent_required for identity-bearing, valuable, powerful, owned, possessed, damaged, moved, scheduled, unique, or future-causal details.
- Mark currency, weapons, ammunition, credentials, keys, vehicles, named people, rare medicine, major resources, security access, and high-value items with the matching advantage category. Such premises may never be plausible_ephemeral or scene_local.
- Established facts must be grounded in supplied player-visible context.
- requiresSearch means the terminal intent is search or an asserted premise is materially uncertain and cannot safely be accepted provisionally.
- Do not determine success, damage, nutrition, injury, contamination, or other mechanics.
- Do not invent persistent IDs.

COMMAND:
${parsed.command}

CURRENT SCENE:
${JSON.stringify(parsed.gameMasterContext.currentScene)}

RECENT TURNS:
${JSON.stringify(parsed.gameMasterContext.recentTurns)}

RELEVANT MEMORIES:
${JSON.stringify(parsed.gameMasterContext.relevantMemories)}

PLAYER-KNOWN FACTS:
${JSON.stringify(parsed.gameMasterContext.playerKnownFacts)}

RESOLVED ENTITY IDS:
${JSON.stringify(parsed.resolvedEntityIds)}

ENABLED HANDLERS:
${JSON.stringify(parsed.enabledHandlers)}`;
}

export async function assessEnvironmentalAffordances(
  client: Pick<AiProviderClient, "generateStructured">,
  input: AffordanceAssessmentRequest,
): Promise<StructuredGenerationResult<AffordanceAssessment>> {
  const parsedInput = AffordanceAssessmentRequestSchema.parse(input);
  const result = await client.generateStructured(
    {
      task: "assess_environmental_affordances",
      system: `You are Nocturne's affordance and persistence adjudicator. Policy ${AFFORDANCE_ASSESSMENT_POLICY_VERSION}. Classify intent and authority boundaries only. Output only the required structured object.`,
      prompt: buildAffordanceAssessmentPrompt(parsedInput),
      jsonSchema: assessmentJsonSchema,
      validator: AffordanceAssessmentSchema,
    },
    2,
  );
  return {
    ...result,
    data: validateAffordanceAssessment(result.data, parsedInput),
  };
}

export async function assessEnvironmentalAffordancesResilient(
  client: Pick<AiProviderClient, "generateStructured">,
  input: AffordanceAssessmentRequest,
): Promise<{
  assessment: AffordanceAssessment;
  source: "provider" | "conservative_fallback";
  providerResult?: StructuredGenerationResult<AffordanceAssessment>;
  providerError?: string;
}> {
  try {
    const providerResult = await assessEnvironmentalAffordances(client, input);
    return { assessment: providerResult.data, source: "provider", providerResult };
  } catch (error) {
    return {
      assessment: deriveConservativeAffordanceAssessment(input),
      source: "conservative_fallback",
      providerError: error instanceof Error ? error.message : String(error),
    };
  }
}
