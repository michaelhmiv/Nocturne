import { describe, expect, it } from "vitest";
import {
  PlayerSafeConversationHistorySchema,
  PlayerSafeConversationResponseSchema,
  type AuthoritativeConversationResponse,
} from "@nocturne/contracts";
import { redactConversationHistory, redactConversationResponse } from "../src/context-service.js";

const authoritative: AuthoritativeConversationResponse = {
  responseId: "response:question",
  narration: "The clock reads midnight.",
  execution: { state: "completed" },
  plan: {
    viewpointPlan: {
      intent: { kind: "question", summary: "Ask the time." },
      facts: [
        {
          factId: "fact:clock",
          claim: "A clock is visible.",
          value: true,
          validity: { state: "valid", validFromTurn: 1 },
          provenance: { kind: "world_state", sourceId: "clock:one" },
          viewpointId: "character:one",
          visibility: "player_known",
        },
      ],
      checks: [],
    },
    hiddenFacts: [
      {
        factId: "fact:hidden:clock",
        claim: "SECRET_CLOCK_MECHANISM",
        value: "concealed",
        validity: { state: "valid", validFromTurn: 1 },
        provenance: { kind: "world_state", sourceId: "clock:one" },
        viewpointId: "character:one",
        visibility: "authoritative_hidden",
      },
    ],
    checkAuthorizations: [],
    hiddenChecks: [],
    unconditionalOperations: [],
  },
  outcomes: [],
  hiddenOutcomes: [],
};

describe("player-safe context projection", () => {
  it("uses one strict redaction path for responses and history", () => {
    const safe = redactConversationResponse(authoritative);

    expect(PlayerSafeConversationResponseSchema.safeParse(safe).success).toBe(true);
    expect(safe.plan).toEqual(authoritative.plan.viewpointPlan);
    expect(JSON.stringify(safe)).not.toContain("SECRET_CLOCK_MECHANISM");
    expect(JSON.stringify(safe)).not.toContain("hiddenFacts");

    const history = redactConversationHistory([
      { request: { message: "What time is it?" }, response: authoritative },
    ]);
    expect(PlayerSafeConversationHistorySchema.safeParse(history).success).toBe(true);
    expect(JSON.stringify(history)).not.toContain("SECRET_CLOCK_MECHANISM");
  });
});
