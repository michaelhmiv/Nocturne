import { createHash } from "node:crypto";
import {
  AuthoritativeConversationResponseSchema,
  ConversationMessageRequestSchema,
  PlayerSafeConversationResponseSchema,
  type ConversationStateOperation,
  type FactReference,
  type PlayerSafeConversationResponse,
} from "@nocturne/contracts";
import {
  authorizeConversation,
  narratePlayerSafeConversation,
  proposeViewpointConversation,
  type OpenRouterClient,
} from "@nocturne/ai-gm";
import { resolveProbabilityCheck } from "@nocturne/rules-engine";
import { redactConversationResponse } from "./context-service.js";

type Turn = {
  turnId: string;
  status: "pending" | "completed" | "failed";
  playerSafeResponse: unknown | null;
  errorCode?: string | null;
  updatedAt: Date;
};

type Turns = {
  reserveTurn(
    userId: string,
    conversationId: string,
    idempotencyKey: string,
    requestHash: string,
    request: unknown,
  ): Promise<{ kind: "created" | "existing"; turn: Turn }>;
  completeTurn(
    userId: string,
    turnId: string,
    authoritativeResponse: unknown,
    playerSafeResponse: unknown,
    leaseUpdatedAt?: Date,
  ): Promise<unknown>;
  failTurn(
    userId: string,
    turnId: string,
    errorCode: string,
    leaseUpdatedAt?: Date,
  ): Promise<unknown>;
  reopenTurn(userId: string, turnId: string, staleBefore: Date): Promise<Turn>;
  listPlayerSafeHistory(
    userId: string,
    conversationId: string,
  ): Promise<NonNullable<Parameters<typeof proposeViewpointConversation>[1]["playerSafeHistory"]>>;
};

export class ConversationServiceError extends Error {
  constructor(
    readonly code: "in_progress" | "turn_failed" | "unsupported_plan",
    message: string,
  ) {
    super(message);
    this.name = "ConversationServiceError";
  }
}

export function createConversationService(dependencies: {
  client: Pick<OpenRouterClient, "generateStructured">;
  turns: Turns;
  rollSecret?: string | Buffer;
  applyStateOperations?(input: {
    userId: string;
    viewpointId: string;
    turnId: string;
    eventId: string;
    leaseUpdatedAt?: Date;
    declaredFactIds: string[];
    operations: ConversationStateOperation[];
  }): Promise<unknown>;
  loadContext(input: { userId: string }): Promise<{
    viewpointId?: string;
    playerKnownFacts: FactReference[];
    hiddenFacts: FactReference[];
  }>;
}) {
  async function submitMessage(input: {
    userId: string;
    conversationId: string;
    idempotencyKey: string;
    request: unknown;
  }): Promise<PlayerSafeConversationResponse> {
    const request = ConversationMessageRequestSchema.parse(input.request);
    const requestHash = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    const reservation = await dependencies.turns.reserveTurn(
      input.userId,
      input.conversationId,
      input.idempotencyKey,
      requestHash,
      request,
    );

    let activeTurn = reservation.turn;
    if (reservation.kind === "existing") {
      if (activeTurn.status === "completed")
        return PlayerSafeConversationResponseSchema.parse(activeTurn.playerSafeResponse);
      if (activeTurn.status === "failed" && activeTurn.errorCode === "unsupported_plan")
        throw new ConversationServiceError("turn_failed", activeTurn.errorCode);
      try {
        activeTurn = await dependencies.turns.reopenTurn(
          input.userId,
          activeTurn.turnId,
          new Date(Date.now() - 60_000),
        );
      } catch {
        if (activeTurn.status === "pending")
          throw new ConversationServiceError(
            "in_progress",
            "Conversation turn is still in progress.",
          );
        throw new ConversationServiceError(
          "turn_failed",
          activeTurn.errorCode || "Conversation turn failed.",
        );
      }
    }

    try {
      const playerSafeHistory = await dependencies.turns.listPlayerSafeHistory(
        input.userId,
        input.conversationId,
      );
      let context = await dependencies.loadContext({ userId: input.userId });
      const viewpoint = await proposeViewpointConversation(dependencies.client, {
        message: request.message,
        playerKnownFacts: context.playerKnownFacts,
        playerSafeHistory,
      });
      const authorization = await authorizeConversation(dependencies.client, {
        message: request.message,
        viewpointPlan: viewpoint.data,
        hiddenFacts: context.hiddenFacts,
        playerSafeHistory,
      });
      const plan = authorization.data;
      let stateCommitted = false;
      if (
        plan.checkAuthorizations.some((check) => check.outcomeBranches.length > 0) ||
        plan.hiddenChecks.some((check) => check.outcomeBranches.length > 0)
      ) {
        throw new ConversationServiceError(
          "unsupported_plan",
          "State-changing check branches are not connected yet.",
        );
      }
      if (plan.unconditionalOperations.length > 0) {
        if (!dependencies.applyStateOperations || !context.viewpointId)
          throw new ConversationServiceError(
            "unsupported_plan",
            "State operation execution requires an active viewpoint.",
          );
        await dependencies.applyStateOperations({
          userId: input.userId,
          viewpointId: context.viewpointId,
          turnId: activeTurn.turnId,
          eventId: activeTurn.turnId,
          leaseUpdatedAt: activeTurn.updatedAt,
          declaredFactIds: [...plan.viewpointPlan.facts, ...plan.hiddenFacts].map(
            ({ factId }) => factId,
          ),
          operations: plan.unconditionalOperations,
        });
        stateCommitted = true;
        context = await dependencies.loadContext({ userId: input.userId });
      }

      if (
        (plan.checkAuthorizations.length > 0 || plan.hiddenChecks.length > 0) &&
        !dependencies.rollSecret
      )
        throw new ConversationServiceError(
          "unsupported_plan",
          "Probability roll secret is missing.",
        );
      const outcomes: PlayerSafeConversationResponse["outcomes"] = [];
      for (const [index, check] of plan.checkAuthorizations.entries()) {
        const rolled = resolveProbabilityCheck({
          serverSecret: dependencies.rollSecret!,
          eventId: activeTurn.turnId,
          checkOrder: check.order,
          checkKind: "primary_action",
          authoritativeProbability: check.authoritativeProbability,
        });
        const stakes = plan.viewpointPlan.checks[index]!.stakes;
        outcomes.push({
          order: check.order,
          finalProbability: check.authoritativeProbability,
          grade: rolled.outcomeGrade,
          rollBasisPoints: rolled.rollBasisPoints,
          summary: rolled.success ? stakes.success : stakes.failure,
        });
        if (!rolled.success) break;
      }
      const completedOrder = outcomes.at(-1)?.order ?? 0;
      const hiddenOutcomes = plan.hiddenChecks
        .filter((check) => check.triggerAfterOrder <= completedOrder)
        .map((check) => {
          const rolled = resolveProbabilityCheck({
            serverSecret: dependencies.rollSecret!,
            eventId: activeTurn.turnId,
            checkOrder: check.order,
            checkKind: "hidden_reaction",
            authoritativeProbability: check.probability,
          });
          return {
            order: check.order,
            finalProbability: check.probability,
            grade: rolled.outcomeGrade,
            rollBasisPoints: rolled.rollBasisPoints,
            summary: rolled.success ? check.stakes.success : check.stakes.failure,
          };
        });
      const execution: PlayerSafeConversationResponse["execution"] =
        outcomes.length < plan.checkAuthorizations.length
          ? { state: "stopped", stoppedAfterOrder: completedOrder }
          : { state: "completed" };
      let narration: string;
      try {
        narration = (
          await narratePlayerSafeConversation(dependencies.client, {
            message: request.message,
            viewpointPlan: plan.viewpointPlan,
            execution,
            outcomes,
            visibleCommittedFacts: context.playerKnownFacts,
          })
        ).data.narration;
      } catch (error) {
        if (outcomes.length === 0 && hiddenOutcomes.length === 0 && !stateCommitted) throw error;
        narration =
          outcomes
            .map(
              (outcome) =>
                `Check ${outcome.order}: probability ${outcome.finalProbability.basisPoints} basis points; roll ${outcome.rollBasisPoints ?? "not required"}; ${outcome.summary}`,
            )
            .join(" ") || "The requested change was committed.";
      }
      const authoritativeResponse = AuthoritativeConversationResponseSchema.parse({
        responseId: activeTurn.turnId,
        narration,
        plan,
        execution,
        outcomes,
        hiddenOutcomes,
      });
      const playerSafeResponse = redactConversationResponse(authoritativeResponse);
      await dependencies.turns.completeTurn(
        input.userId,
        activeTurn.turnId,
        authoritativeResponse,
        playerSafeResponse,
        activeTurn.updatedAt,
      );
      return playerSafeResponse;
    } catch (error) {
      const code = error instanceof ConversationServiceError ? error.code : "processing_error";
      await dependencies.turns
        .failTurn(input.userId, activeTurn.turnId, code, activeTurn.updatedAt)
        .catch(() => {});
      throw error;
    }
  }

  return { submitMessage };
}
