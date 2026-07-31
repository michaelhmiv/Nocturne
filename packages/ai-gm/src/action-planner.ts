import {
  ActionPlanEnvelopeSchema,
  type ActionPlanEnvelope,
  type SubmitActionRequest,
} from "@nocturne/contracts";
import { deterministicActionFallback } from "./action-adjudicator.js";
import { AiProviderClient, type StructuredGenerationResult } from "./ai-provider.js";

export const ACTION_PLAN_POLICY_VERSION = "action-plan-v1";

const actionPlanJsonSchema = {
  name: "nocturne_action_plan",
  description:
    "An ordered decomposition of a player command into independently resolvable actions.",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "steps", "assumptions"],
    properties: {
      summary: { type: "string" },
      steps: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "stepId",
            "rawText",
            "actionType",
            "objective",
            "dependsOnPreviousSuccess",
            "assumptions",
            "confidence",
          ],
          properties: {
            stepId: { type: "string" },
            rawText: { type: "string" },
            actionType: { type: "string" },
            objective: { type: "string" },
            dependsOnPreviousSuccess: { type: "boolean" },
            targetLocationId: { type: "string" },
            assumptions: { type: "array", maxItems: 6, items: { type: "string" } },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
        },
      },
      assumptions: { type: "array", maxItems: 8, items: { type: "string" } },
    },
  },
} as const;

export function buildActionPlanPrompt(
  input: SubmitActionRequest,
  publicContext: Record<string, unknown>,
): string {
  return `Decompose the player's command into the smallest ordered set of actions that must be resolved separately.

Planning rules:
- Preserve the player's wording and order. Do not resolve outcomes, consume inventory, move the character, or narrate consequences.
- A command containing multiple sequential verbs normally requires multiple steps.
- Keep one step when the command is genuinely one atomic action.
- Set dependsOnPreviousSuccess=true only when the later action is impossible or nonsensical unless the immediately previous action succeeds. Example: "unlock the door, then enter" is dependent.
- Set dependsOnPreviousSuccess=false when the later action should still be attempted after a partial or failed earlier action. Example: "eat five bowls, then walk to the gas station" contains independent consumption and travel steps.
- Eating, drinking, swallowing, ingesting, or tasting is consume. Walking or going to a destination is move. Driving is drive.
- Do not invent inventory, foods, destinations, missions, possessions, capabilities, or hidden facts. There is no item or food catalogue; downstream semantic resolvers handle arbitrary substances.
- Each rawText value must be a self-contained command for that single step, including requested quantities and destination names.
- Use supplied targetLocationId only when the context explicitly establishes it.

PLAYER COMMAND:
${input.rawText}

PUBLIC CONTEXT:
${JSON.stringify(publicContext)}`;
}

export async function parseActionPlanWithAi(
  client: AiProviderClient,
  input: SubmitActionRequest,
  publicContext: Record<string, unknown>,
): Promise<StructuredGenerationResult<ActionPlanEnvelope>> {
  return client.generateStructured({
    task: "parse_intent",
    system: `You are Nocturne's ordered action planner. Policy ${ACTION_PLAN_POLICY_VERSION}. You only decompose commands; downstream deterministic services establish world state. Output only the required structured object.`,
    prompt: buildActionPlanPrompt(input, publicContext),
    jsonSchema: actionPlanJsonSchema,
    validator: ActionPlanEnvelopeSchema,
  });
}

function splitFallbackSteps(rawText: string): string[] {
  const clauses = rawText
    .split(/\b(?:and\s+then|then|afterwards?)\b/gi)
    .map((value) => value.trim().replace(/^[,;]+|[,;]+$/g, ""))
    .filter(Boolean);
  return clauses.length ? clauses.slice(0, 8) : [rawText.trim()];
}

export function deterministicActionPlanFallback(
  input: SubmitActionRequest,
  methodDefinitionId: string,
  targetLocationId: string,
): ActionPlanEnvelope {
  const clauses = splitFallbackSteps(input.rawText);
  return ActionPlanEnvelopeSchema.parse({
    summary: clauses.length === 1 ? clauses[0] : `Resolve ${clauses.length} ordered actions.`,
    steps: clauses.map((rawText, index) => {
      const parsed = deterministicActionFallback(
        { ...input, rawText },
        methodDefinitionId,
        targetLocationId,
      );
      return {
        stepId: `step-${index + 1}`,
        rawText,
        actionType: parsed.intent.actionType,
        objective: parsed.intent.objective,
        dependsOnPreviousSuccess:
          index > 0 && /\b(unlock|open|disable|remove|break)\b/i.test(clauses[index - 1] || ""),
        targetLocationId: input.targetLocationId,
        assumptions: parsed.intent.assumptions,
        confidence: Math.min(parsed.intent.confidence, 0.75),
      };
    }),
    assumptions: ["Development fallback planning was used."],
  });
}
