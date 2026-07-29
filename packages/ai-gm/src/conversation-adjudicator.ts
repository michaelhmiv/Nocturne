import { z } from "zod";
import {
  AuthoritativeConversationPlanSchema,
  ConversationMessageRequestSchema,
  HiddenFactReferenceSchema,
  MAX_CONVERSATION_FACTS,
  PlayerSafeConversationResponseSchema,
  PublicFactReferenceSchema,
  ViewpointConversationPlanSchema,
  type AuthoritativeConversationPlan,
  type FactReference,
  type PlayerSafeConversationResponse,
  type ViewpointConversationPlan,
} from "@nocturne/contracts";
import {
  OpenRouterError,
  type JsonSchemaDefinition,
  type OpenRouterClient,
  type StructuredGenerationResult,
} from "./openrouter.js";

export const VIEWPOINT_ADJUDICATION_POLICY_VERSION = "conversation-viewpoint-v1";
export const AUTHORITATIVE_ADJUDICATION_POLICY_VERSION = "conversation-authoritative-v1";
export const PLAYER_SAFE_NARRATION_POLICY_VERSION = "conversation-narration-v1";

type Generator = Pick<OpenRouterClient, "generateStructured">;

const PlayerSafeNarrationSchema = z
  .object({ narration: z.string().trim().min(1).max(8_000) })
  .strict();

function jsonSchema(name: string, schema: z.ZodType): JsonSchemaDefinition {
  return {
    name,
    schema: z.toJSONSchema(schema, { unrepresentable: "any" }) as Record<string, unknown>,
  };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validatedResult<T>(
  result: StructuredGenerationResult<unknown>,
  schema: z.ZodType<T>,
): StructuredGenerationResult<T> {
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    throw new OpenRouterError(
      "validation",
      `Structured model output failed validation: ${parsed.error.message}`,
    );
  }
  return { ...result, data: parsed.data };
}

export async function proposeViewpointConversation(
  client: Generator,
  input: { message: string; playerKnownFacts: FactReference[] },
): Promise<StructuredGenerationResult<ViewpointConversationPlan>> {
  const message = ConversationMessageRequestSchema.parse({ message: input.message }).message;
  const facts = z
    .array(PublicFactReferenceSchema)
    .max(MAX_CONVERSATION_FACTS)
    .parse(input.playerKnownFacts);
  const generation = await client.generateStructured<ViewpointConversationPlan>({
    task: "propose_adjudication",
    system: `You are Nocturne's player-viewpoint adjudicator. Policy ${VIEWPOINT_ADJUDICATION_POLICY_VERSION}. Infer ordinary conversational intent. Propose only meaningful uncertainty checks. Use and cite only supplied player-known facts. Never invent hidden context, roll dice, authorize writes, or coach the player toward canned actions.`,
    prompt: JSON.stringify({ message, playerKnownFacts: facts }),
    jsonSchema: jsonSchema("nocturne_viewpoint_conversation_plan", ViewpointConversationPlanSchema),
    validator: ViewpointConversationPlanSchema,
  });
  const result = validatedResult(generation, ViewpointConversationPlanSchema);
  if (!sameJson(result.data.facts, facts)) {
    throw new OpenRouterError("validation", "The viewpoint pass rewrote its frozen fact set.");
  }
  return result;
}

export async function authorizeConversation(
  client: Generator,
  input: {
    message: string;
    viewpointPlan: ViewpointConversationPlan;
    hiddenFacts: FactReference[];
  },
): Promise<StructuredGenerationResult<AuthoritativeConversationPlan>> {
  const message = ConversationMessageRequestSchema.parse({ message: input.message }).message;
  const viewpointPlan = ViewpointConversationPlanSchema.parse(input.viewpointPlan);
  const hiddenFacts = z
    .array(HiddenFactReferenceSchema)
    .max(MAX_CONVERSATION_FACTS - viewpointPlan.facts.length)
    .parse(input.hiddenFacts);
  const generation = await client.generateStructured<AuthoritativeConversationPlan>({
    task: "propose_adjudication",
    system: `You are Nocturne's authoritative adjudicator. Policy ${AUTHORITATIVE_ADJUDICATION_POLICY_VERSION}. Preserve the supplied viewpoint plan byte-for-byte. You may add only cited hidden adjustments, separate hidden reactions, and allowlisted state operations with cited preconditions. Never roll dice, narrate to the player, or perform writes.`,
    prompt: JSON.stringify({ message, viewpointPlan, hiddenFacts }),
    jsonSchema: jsonSchema(
      "nocturne_authoritative_conversation_plan",
      AuthoritativeConversationPlanSchema,
    ),
    validator: AuthoritativeConversationPlanSchema,
  });
  const result = validatedResult(generation, AuthoritativeConversationPlanSchema);
  if (!sameJson(result.data.viewpointPlan, viewpointPlan)) {
    throw new OpenRouterError(
      "validation",
      "The authoritative pass rewrote the frozen viewpoint plan.",
    );
  }
  if (!sameJson(result.data.hiddenFacts, hiddenFacts)) {
    throw new OpenRouterError(
      "validation",
      "The authoritative pass rewrote its frozen hidden fact set.",
    );
  }
  return result;
}

export async function narratePlayerSafeConversation(
  client: Generator,
  input: {
    message: string;
    viewpointPlan: ViewpointConversationPlan;
    execution: PlayerSafeConversationResponse["execution"];
    outcomes: PlayerSafeConversationResponse["outcomes"];
    visibleCommittedFacts: FactReference[];
  },
): Promise<StructuredGenerationResult<{ narration: string }>> {
  const message = ConversationMessageRequestSchema.parse({ message: input.message }).message;
  const response = PlayerSafeConversationResponseSchema.parse({
    responseId: "narration-input",
    narration: "Pending narration.",
    plan: input.viewpointPlan,
    execution: input.execution,
    outcomes: input.outcomes,
  });
  const conversational = ["question", "dialogue", "out_of_character"].includes(
    response.plan.intent.kind,
  );
  const safeInput = {
    request: conversational ? { message, intent: response.plan.intent } : undefined,
    execution: response.execution,
    outcomes: response.outcomes,
    visibleCommittedFacts: z
      .array(PublicFactReferenceSchema)
      .max(24)
      .parse(input.visibleCommittedFacts),
  };
  const generation = await client.generateStructured<{ narration: string }>({
    task: "narrate_event",
    system: `Narrate only the supplied player-safe committed result. Policy ${PLAYER_SAFE_NARRATION_POLICY_VERSION}. Do not infer hidden causes, modifiers, reactions, state operations, or facts. Do not coach the player toward a next action.`,
    prompt: JSON.stringify(safeInput),
    jsonSchema: jsonSchema("nocturne_player_safe_narration", PlayerSafeNarrationSchema),
    validator: PlayerSafeNarrationSchema,
  });
  return validatedResult(generation, PlayerSafeNarrationSchema);
}
