import {
  AuthoritativeConversationHistorySchema,
  AuthoritativeConversationResponseSchema,
  PlayerSafeConversationHistorySchema,
  PlayerSafeConversationResponseSchema,
  type PlayerSafeConversationResponse,
} from "@nocturne/contracts";

export function redactConversationResponse(value: unknown): PlayerSafeConversationResponse {
  const response = AuthoritativeConversationResponseSchema.parse(value);
  return PlayerSafeConversationResponseSchema.parse({
    responseId: response.responseId,
    narration: response.narration,
    plan: response.plan.viewpointPlan,
    execution: response.execution,
    outcomes: response.outcomes,
  });
}

export function redactConversationHistory(value: unknown) {
  const history = AuthoritativeConversationHistorySchema.parse(value);
  return PlayerSafeConversationHistorySchema.parse(
    history.map(({ request, response }) => ({
      request,
      response: redactConversationResponse(response),
    })),
  );
}
