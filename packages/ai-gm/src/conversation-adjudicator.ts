import { z } from "zod";
import {
  AuthoritativeConversationPlanSchema,
  ConversationMessageRequestSchema,
  HiddenFactReferenceSchema,
  MAX_CONVERSATION_FACTS,
  PlayerSafeConversationHistorySchema,
  PlayerSafeConversationResponseSchema,
  PublicFactReferenceSchema,
  ViewpointConversationPlanSchema,
  type AuthoritativeConversationPlan,
  type FactReference,
  type PlayerSafeConversationResponse,
  type ViewpointConversationPlan,
} from "@nocturne/contracts";
import {
  AiProviderError,
  type JsonSchemaDefinition,
  type AiProviderClient,
  type StructuredGenerationResult,
} from "./ai-provider.js";

export const VIEWPOINT_ADJUDICATION_POLICY_VERSION = "conversation-viewpoint-v1";
export const AUTHORITATIVE_ADJUDICATION_POLICY_VERSION = "conversation-authoritative-v1";
export const PLAYER_SAFE_NARRATION_POLICY_VERSION = "conversation-narration-v1";

type Generator = Pick<AiProviderClient, "generateStructured">;

const PlayerSafeNarrationSchema = z
  .object({ narration: z.string().trim().min(1).max(8_000) })
  .strict();

function jsonSchema(name: string, schema: z.ZodType): JsonSchemaDefinition {
  return {
    name,
    schema: z.toJSONSchema(schema, { unrepresentable: "any" }) as Record<string, unknown>,
  };
}

const ViewpointOutputSchema = z
  .object({
    intent: ViewpointConversationPlanSchema.shape.intent,
    checks: ViewpointConversationPlanSchema.shape.checks,
  })
  .strict();
const AuthoritativeOutputSchema = z
  .object({
    checkAuthorizations: AuthoritativeConversationPlanSchema.shape.checkAuthorizations,
    hiddenChecks: AuthoritativeConversationPlanSchema.shape.hiddenChecks,
    unconditionalOperations: AuthoritativeConversationPlanSchema.shape.unconditionalOperations,
  })
  .strict();

function validatedResult<T>(
  result: StructuredGenerationResult<unknown>,
  schema: z.ZodType<T>,
): StructuredGenerationResult<T> {
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    throw new AiProviderError(
      "validation",
      `Structured model output failed validation: ${parsed.error.message}`,
    );
  }
  return { ...result, data: parsed.data };
}

export async function proposeViewpointConversation(
  client: Generator,
  input: {
    message: string;
    playerKnownFacts: FactReference[];
    playerSafeHistory?: z.infer<typeof PlayerSafeConversationHistorySchema>;
  },
): Promise<StructuredGenerationResult<ViewpointConversationPlan>> {
  const message = ConversationMessageRequestSchema.parse({ message: input.message }).message;
  const facts = z
    .array(PublicFactReferenceSchema)
    .max(MAX_CONVERSATION_FACTS)
    .parse(input.playerKnownFacts);
  const playerSafeHistory = PlayerSafeConversationHistorySchema.parse(
    input.playerSafeHistory ?? [],
  );
  const isQuestion =
    message.endsWith("?") ||
    /^(?:what|where|when|who|why|how|is|are|can|could|do|does|did|will|would|should)\b/i.test(
      message,
    );
  if (isQuestion) {
    return {
      data: ViewpointConversationPlanSchema.parse({
        intent: { kind: "question", summary: message },
        facts,
        checks: [],
      }),
      requestedModel: "deterministic/no-roll",
      actualModel: "deterministic/no-roll",
    };
  }
  const generation = await client.generateStructured<z.infer<typeof ViewpointOutputSchema>>({
    task: "propose_adjudication",
    system: `You are Nocturne's player-viewpoint adjudicator. Policy ${VIEWPOINT_ADJUDICATION_POLICY_VERSION}. Infer ordinary conversational intent. Propose only meaningful uncertainty checks. Use and cite only supplied player-known facts. Never invent hidden context, roll dice, authorize writes, or coach the player toward canned actions.`,
    prompt: JSON.stringify({ message, playerKnownFacts: facts, playerSafeHistory }),
    jsonSchema: jsonSchema("nocturne_viewpoint_conversation_plan", ViewpointOutputSchema),
    validator: ViewpointOutputSchema,
  });
  return validatedResult(
    {
      ...generation,
      data: {
        ...generation.data,
        intent: generation.data.intent,
        checks: generation.data.checks,
        facts,
      },
    },
    ViewpointConversationPlanSchema,
  );
}

export async function authorizeConversation(
  client: Generator,
  input: {
    message: string;
    viewpointPlan: ViewpointConversationPlan;
    hiddenFacts: FactReference[];
    playerSafeHistory?: z.infer<typeof PlayerSafeConversationHistorySchema>;
  },
): Promise<StructuredGenerationResult<AuthoritativeConversationPlan>> {
  const message = ConversationMessageRequestSchema.parse({ message: input.message }).message;
  const viewpointPlan = ViewpointConversationPlanSchema.parse(input.viewpointPlan);
  const hiddenFacts = z
    .array(HiddenFactReferenceSchema)
    .max(MAX_CONVERSATION_FACTS - viewpointPlan.facts.length)
    .parse(input.hiddenFacts);
  const playerSafeHistory = PlayerSafeConversationHistorySchema.parse(
    input.playerSafeHistory ?? [],
  );
  if (viewpointPlan.intent.kind === "question" && viewpointPlan.checks.length === 0) {
    return {
      data: AuthoritativeConversationPlanSchema.parse({
        viewpointPlan,
        hiddenFacts,
        checkAuthorizations: [],
        hiddenChecks: [],
        unconditionalOperations: [],
      }),
      requestedModel: "deterministic/no-roll",
      actualModel: "deterministic/no-roll",
    };
  }
  const generation = await client.generateStructured<z.infer<typeof AuthoritativeOutputSchema>>({
    task: "propose_adjudication",
    system: `You are Nocturne's authoritative adjudicator. Policy ${AUTHORITATIVE_ADJUDICATION_POLICY_VERSION}. Preserve the supplied viewpoint plan byte-for-byte. You may add only cited hidden adjustments, separate hidden reactions, and allowlisted state operations with cited preconditions. Never roll dice, narrate to the player, or perform writes.`,
    prompt: JSON.stringify({ message, viewpointPlan, hiddenFacts, playerSafeHistory }),
    jsonSchema: jsonSchema("nocturne_authoritative_conversation_plan", AuthoritativeOutputSchema),
    validator: AuthoritativeOutputSchema,
  });
  return validatedResult(
    { ...generation, data: { ...generation.data, viewpointPlan, hiddenFacts } },
    AuthoritativeConversationPlanSchema,
  );
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
