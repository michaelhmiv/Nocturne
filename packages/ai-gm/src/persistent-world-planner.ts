import {
  AffordanceAssessmentRequestSchema,
  WorldActionPlannerRequestSchema,
  WorldActionPlannerResultSchema,
  type AffordanceAssessment,
  type WorldActionPlannerResult,
} from "@nocturne/contracts";
import type { z } from "zod";
import { AiProviderClient, type StructuredGenerationResult } from "./ai-provider.js";
import {
  assessEnvironmentalAffordancesResilient,
  deriveConservativeAffordanceAssessment,
} from "./affordance-adjudicator.js";
import { buildGameConstitutionPrompt } from "./game-constitution.js";

export const PERSISTENT_WORLD_PLANNER_POLICY_VERSION = "persistent-world-planner-v5";

type PlannerRequest = z.infer<typeof WorldActionPlannerRequestSchema>;

export type PersistentWorldPlanningResult = StructuredGenerationResult<WorldActionPlannerResult> & {
  affordanceAssessment: AffordanceAssessment;
  affordanceSource: "provider" | "conservative_fallback";
  affordanceProviderError?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const persistentWorldPlannerJsonSchema = {
  name: "nocturne_persistent_world_action_plan",
  description: "Route one player command into a durable action plan using enabled handlers.",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["primaryKind", "requiresClarification", "rationale"],
    properties: {
      primaryKind: {
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
      requiresClarification: { type: "boolean" },
      clarificationPrompt: { type: "string" },
      rationale: { type: "string" },
      plan: {
        type: "object",
        additionalProperties: false,
        required: ["originalCommand", "exclusivePhysical", "steps", "dependencies"],
        properties: {
          originalCommand: { type: "string" },
          exclusivePhysical: { type: "boolean" },
          steps: {
            type: "array",
            minItems: 1,
            maxItems: 64,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["order", "kind", "description", "intentPayload", "referencedEntities"],
              properties: {
                order: { type: "integer", minimum: 1, maximum: 64 },
                kind: { type: "string" },
                description: { type: "string" },
                intentPayload: { type: "object", additionalProperties: true },
                referencedEntities: {
                  type: "array",
                  maxItems: 32,
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["entityId", "role"],
                    properties: {
                      entityId: { type: "string" },
                      role: {
                        enum: [
                          "actor",
                          "target",
                          "location",
                          "method",
                          "resource",
                          "companion",
                          "vehicle",
                          "container",
                          "other",
                        ],
                      },
                      referenceText: { type: "string" },
                      expectedVersion: { type: "integer", minimum: 0 },
                    },
                  },
                },
              },
            },
          },
          dependencies: {
            type: "array",
            maxItems: 128,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["stepOrder", "dependencyType", "parameters"],
              properties: {
                stepOrder: { type: "integer", minimum: 1, maximum: 64 },
                dependsOnStepOrder: { type: "integer", minimum: 1, maximum: 64 },
                dependencyType: {
                  enum: [
                    "after_step_completed",
                    "after_step_succeeded",
                    "after_arrival",
                    "after_entity_present",
                    "after_item_acquired",
                    "after_time",
                    "after_event",
                    "after_clarification",
                    "after_access_granted",
                  ],
                },
                parameters: { type: "object", additionalProperties: true },
              },
            },
          },
        },
      },
    },
  },
} as const;

function collectVisibleUuids(value: unknown, collected = new Set<string>()) {
  if (typeof value === "string") {
    if (UUID_PATTERN.test(value)) collected.add(value.toLowerCase());
    return collected;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectVisibleUuids(item, collected);
    return collected;
  }
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) collectVisibleUuids(nested, collected);
  }
  return collected;
}

function allowedPlannerEntityIds(input: PlannerRequest) {
  const allowed = collectVisibleUuids(input.playerKnownFacts);
  collectVisibleUuids(input.activePlanSummary, allowed);
  collectVisibleUuids(input.gameMasterContext, allowed);
  allowed.add(input.actorId.toLowerCase());
  for (const entityId of input.resolvedEntityIds) allowed.add(entityId.toLowerCase());
  return allowed;
}

function defaultAssessment(input: PlannerRequest) {
  return deriveConservativeAffordanceAssessment(
    AffordanceAssessmentRequestSchema.parse({
      command: input.command,
      actorId: input.actorId,
      resolvedEntityIds: input.resolvedEntityIds,
      gameMasterContext: input.gameMasterContext,
      enabledHandlers: input.enabledHandlers,
    }),
  );
}

export function buildPersistentWorldPlannerPrompt(
  input: PlannerRequest,
  assessment: AffordanceAssessment = defaultAssessment(input),
) {
  const parsed = WorldActionPlannerRequestSchema.parse(input);
  return `${buildGameConstitutionPrompt(parsed.gameMasterContext.constitution)}

Route the player's command into one durable persistent-world action plan.

Rules:
- Use only enabled handler kinds.
- primaryKind represents the player's terminal intent from AFFORDANCE ASSESSMENT, even when earlier plan steps perform travel or another prerequisite.
- Supporting motions, incidental source descriptions, and mundane acquisition gestures do not replace terminal intent.
- When a premise is plausible_ephemeral and requiresSearch is false, accept it provisionally for this resolution. Do not create a search step, durable entity, inventory item, or UUID merely to prove it exists.
- Copy ephemeral and scene-local premises used by a step into intentPayload.environmentalAffordances with concept, role, and status. A consume step using an ephemeral premise must set intentPayload.sourceMode to ephemeral_environmental.
- A persistent_required, contradictory, or uncertain premise cannot be treated as an ephemeral advantage. Require supplied authority, a legitimate search/materialization path, or clarification.
- Use only persistent entity IDs already present in ACTOR ID, RESOLVED ENTITY IDS, PLAYER-KNOWN FACTS, CURRENT SCENE, RECENT TURNS, RELEVANT MEMORIES, or ACTIVE PLAN. Never invent a persistent UUID.
- Recent turns and memories provide narrative continuity but never override current authoritative facts.
- If a material persistent entity is referenced ambiguously or required information is missing, request clarification instead of guessing.
- A search concept such as "a dog" is allowed in search intentPayload without an existing entity ID. It does not imply the dog exists.
- A requested consumable may remain an open-ended semantic concept. Do not require an existing entity ID merely because the player names food, drink, medicine, or another substance.
- Preserve the player's full intended order. Decompose compound commands into explicit steps.
- Use dependencies for actual prerequisites. Travel followed by an action at the destination requires after_arrival, not immediate synchronous success.
- Do not decide outcomes, probabilities, injuries, death, ownership, inventory, or world mutations.
- \`move\` is a durable/scheduled step when travel time is nonzero.
- Discovery is separate from ownership, possession, control, trust, following, custody, and residence.
- Steps must contain enough structured semantic payload for the registered handler, while keeping arbitrary nouns open-ended.
- Every step intentPayload must include rawText containing the self-contained player action for that step.
- Search intentPayload must include areaId and requestedConcept. Move intentPayload must include destinationId.
- referencedEntities must include the actor and every context-supplied persistent entity used by the step, with current expectedVersion when supplied in facts.
- Existing active plans are not silently combined with conflicting physical commands. Produce a new exclusive plan; the runtime will apply explicit supersession policy.
- Dialogue and questions may use one non-state-changing step.
- Do not include narration.

COMMAND:
${parsed.command}

AFFORDANCE ASSESSMENT:
${JSON.stringify(assessment)}

ACTOR ID:
${parsed.actorId}

CURRENT SCENE:
${JSON.stringify(parsed.gameMasterContext.currentScene)}

RECENT TURNS:
${JSON.stringify(parsed.gameMasterContext.recentTurns)}

RELEVANT MEMORIES:
${JSON.stringify(parsed.gameMasterContext.relevantMemories)}

RESOLVED ENTITY IDS:
${JSON.stringify(parsed.resolvedEntityIds)}

PLAYER-KNOWN FACTS:
${JSON.stringify(parsed.playerKnownFacts)}

ACTIVE PLAN:
${JSON.stringify(parsed.activePlanSummary)}

ENABLED HANDLERS:
${JSON.stringify(parsed.enabledHandlers)}`;
}

export function validatePersistentWorldPlan(
  result: WorldActionPlannerResult,
  input: PlannerRequest,
  assessment: AffordanceAssessment = defaultAssessment(input),
) {
  const parsedInput = WorldActionPlannerRequestSchema.parse(input);
  const parsed = WorldActionPlannerResultSchema.parse(result);
  if (!parsedInput.enabledHandlers.includes(parsed.primaryKind)) {
    throw new Error("Planner selected a disabled action handler.");
  }
  if (!parsed.requiresClarification && parsed.primaryKind !== assessment.terminalIntent) {
    throw new Error("Planner primary kind did not preserve the assessed terminal intent.");
  }
  if (!parsed.plan) return parsed;
  const allowedEntityIds = allowedPlannerEntityIds(parsedInput);
  for (const step of parsed.plan.steps) {
    if (!parsedInput.enabledHandlers.includes(step.kind as never)) {
      throw new Error(`Plan step selected a disabled handler: ${step.kind}.`);
    }
    if (typeof step.intentPayload.rawText !== "string" || !step.intentPayload.rawText.trim()) {
      throw new Error("Every persistent-world plan step must include intentPayload.rawText.");
    }
  }
  for (const entityId of collectVisibleUuids(parsed.plan)) {
    if (!allowedEntityIds.has(entityId)) {
      throw new Error("Plan referenced an entity ID absent from player-visible planner context.");
    }
  }
  return parsed;
}

export async function planPersistentWorldAction(
  client: Pick<AiProviderClient, "generateStructured">,
  input: PlannerRequest,
): Promise<PersistentWorldPlanningResult> {
  const parsedInput = WorldActionPlannerRequestSchema.parse(input);
  const affordanceRequest = AffordanceAssessmentRequestSchema.parse({
    command: parsedInput.command,
    actorId: parsedInput.actorId,
    resolvedEntityIds: parsedInput.resolvedEntityIds,
    gameMasterContext: parsedInput.gameMasterContext,
    enabledHandlers: parsedInput.enabledHandlers,
  });
  const assessed = await assessEnvironmentalAffordancesResilient(client, affordanceRequest);
  const result = await client.generateStructured(
    {
      task: "plan_persistent_world_action",
      system: `You are Nocturne's durable persistent-world planner. Policy ${PERSISTENT_WORLD_PLANNER_POLICY_VERSION}. You interpret intent and dependencies but do not resolve outcomes or mutate state. Output only the required structured object.`,
      prompt: buildPersistentWorldPlannerPrompt(parsedInput, assessed.assessment),
      jsonSchema: persistentWorldPlannerJsonSchema,
      validator: WorldActionPlannerResultSchema,
    },
    2,
  );
  return {
    ...result,
    data: validatePersistentWorldPlan(result.data, parsedInput, assessed.assessment),
    affordanceAssessment: assessed.assessment,
    affordanceSource: assessed.source,
    affordanceProviderError: assessed.providerError,
  };
}
