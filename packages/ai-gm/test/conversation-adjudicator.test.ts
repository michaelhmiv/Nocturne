import { describe, expect, it } from "vitest";
import type {
  AuthoritativeConversationPlan,
  FactReference,
  ViewpointConversationPlan,
} from "@nocturne/contracts";
import type { StructuredGenerationRequest, StructuredGenerationResult } from "../src/openrouter.js";
import {
  authorizeConversation,
  narratePlayerSafeConversation,
  proposeViewpointConversation,
} from "../src/conversation-adjudicator.js";

type Band = "impossible" | "remote" | "unlikely" | "even" | "likely" | "near_certain" | "certain";

const probability = (basisPoints: number, band: Band = "likely") => ({
  scale: "nocturne-probability-v1" as const,
  band,
  basisPoints,
});

const playerFact: FactReference = {
  factId: "fact:public:location",
  claim: "The character is in the library.",
  value: "library",
  provenance: { kind: "world_state", sourceId: "event:public" },
  validity: { state: "valid", validFromTurn: 1 },
  viewpointId: "character:one",
  visibility: "player_known",
};

const hiddenFact: FactReference = {
  factId: "fact:hidden:alarm",
  claim: "SECRET_ALARM_PHRASE",
  value: true,
  provenance: { kind: "world_state", sourceId: "event:hidden" },
  validity: { state: "valid", validFromTurn: 1 },
  viewpointId: "character:one",
  visibility: "authoritative_hidden",
};

const committedFact: FactReference = {
  ...playerFact,
  factId: "fact:public:letter",
  claim: "A folded letter is now in the character's possession.",
  value: "folded letter",
};

const viewpointPlan: ViewpointConversationPlan = {
  intent: { kind: "world_action", summary: "Search the desk." },
  facts: [playerFact],
  checks: [
    {
      order: 1,
      label: "Search the desk",
      apparentProbability: probability(7_200),
      publicFactors: [
        {
          summary: "The desk is plainly visible.",
          probabilityDeltaBasisPoints: 0,
          citations: [playerFact.factId],
        },
      ],
      stakes: { success: "Find useful evidence.", failure: "Find nothing useful." },
    },
  ],
};

const authoritativePlan: AuthoritativeConversationPlan = {
  viewpointPlan,
  hiddenFacts: [hiddenFact],
  checkAuthorizations: [
    {
      order: 1,
      hiddenFactors: [
        {
          summary: "A hidden alarm complicates the search.",
          probabilityDeltaBasisPoints: -1_100,
          citations: [hiddenFact.factId],
        },
      ],
      authoritativeProbability: probability(6_100, "even"),
      outcomeBranches: [],
    },
  ],
  hiddenChecks: [],
  unconditionalOperations: [],
};

const playerSafeHistory = [
  {
    request: { message: "Where am I?" },
    response: {
      responseId: "prior-turn",
      narration: "You are in the library.",
      plan: {
        intent: { kind: "question" as const, summary: "Ask where you are." },
        facts: [playerFact],
        checks: [],
      },
      execution: { state: "completed" as const },
      outcomes: [],
    },
  },
];

type Request = StructuredGenerationRequest<unknown>;

function queuedClient(outputs: unknown[]) {
  const requests: Request[] = [];
  return {
    requests,
    client: {
      async generateStructured<T>(request: StructuredGenerationRequest<T>) {
        requests.push(request as Request);
        const output = outputs.shift();
        return {
          data: output as T,
          requestedModel: "test/model",
          actualModel: "test/model",
        } satisfies StructuredGenerationResult<T>;
      },
    },
  };
}

describe("conversation adjudicator", () => {
  it("runs the viewpoint pass with player-known facts only", async () => {
    const mock = queuedClient([viewpointPlan]);
    const result = await proposeViewpointConversation(mock.client, {
      message: "I search the desk.",
      playerKnownFacts: [playerFact],
      playerSafeHistory,
    });

    expect(result.data).toEqual(viewpointPlan);
    expect(mock.requests).toHaveLength(1);
    expect(mock.requests[0]!.task).toBe("propose_adjudication");
    expect(mock.requests[0]!.prompt).toContain(playerFact.claim);
    expect(mock.requests[0]!.prompt).toContain("You are in the library.");
    expect(mock.requests[0]!.prompt).not.toContain(hiddenFact.claim);
    expect((mock.requests[0]!.jsonSchema.schema as any).properties).not.toHaveProperty("facts");
  });

  it("passes the frozen viewpoint result to the authoritative pass", async () => {
    const mock = queuedClient([authoritativePlan]);
    const result = await authorizeConversation(mock.client, {
      message: "I search the desk.",
      viewpointPlan,
      hiddenFacts: [hiddenFact],
      playerSafeHistory,
    });

    expect(result.data).toEqual(authoritativePlan);
    expect(mock.requests[0]!.prompt).toContain(hiddenFact.claim);
    expect(mock.requests[0]!.prompt).toContain("You are in the library.");
    expect(JSON.parse(mock.requests[0]!.prompt).viewpointPlan).toEqual(viewpointPlan);
    expect((mock.requests[0]!.jsonSchema.schema as any).properties).not.toHaveProperty(
      "viewpointPlan",
    );
    expect((mock.requests[0]!.jsonSchema.schema as any).properties).not.toHaveProperty(
      "hiddenFacts",
    );
  });

  it("overwrites model changes to frozen inputs", async () => {
    const rewritten = structuredClone(authoritativePlan);
    rewritten.viewpointPlan.checks[0]!.apparentProbability = probability(5_000, "even");
    rewritten.hiddenFacts[0]!.claim = "A different hidden fact.";
    await expect(
      authorizeConversation(queuedClient([rewritten]).client, {
        message: "I search the desk.",
        viewpointPlan,
        hiddenFacts: [hiddenFact],
      }),
    ).resolves.toMatchObject({ data: authoritativePlan });

    const rewrittenViewpoint = structuredClone(viewpointPlan);
    rewrittenViewpoint.facts[0]!.claim = "A different public fact.";
    await expect(
      proposeViewpointConversation(queuedClient([rewrittenViewpoint]).client, {
        message: "I search the desk.",
        playerKnownFacts: [playerFact],
      }),
    ).resolves.toMatchObject({ data: viewpointPlan });
  });

  it("supports ordinary no-roll conversation", async () => {
    const noRoll: ViewpointConversationPlan = {
      intent: { kind: "question", summary: "Ask what time it is." },
      facts: [playerFact],
      checks: [],
    };
    const proposed = {
      ...noRoll,
      intent: { kind: "world_action" as const, summary: "Check the time." },
      checks: viewpointPlan.checks,
    };
    const mock = queuedClient([proposed]);

    await expect(
      proposeViewpointConversation(mock.client, {
        message: "What time is it?",
        playerKnownFacts: [playerFact],
      }),
    ).resolves.toMatchObject({ data: { intent: { kind: "question" }, checks: [] } });
    expect(mock.requests).toHaveLength(0);
  });

  it("skips authority generation for ordinary no-roll questions", async () => {
    const question = {
      ...viewpointPlan,
      intent: { kind: "question" as const, summary: "Look around." },
      checks: [],
    };
    const mock = queuedClient([]);

    await expect(
      authorizeConversation(mock.client, {
        message: "What can I see?",
        viewpointPlan: question,
        hiddenFacts: [hiddenFact],
      }),
    ).resolves.toMatchObject({
      data: {
        viewpointPlan: question,
        hiddenFacts: [hiddenFact],
        checkAuthorizations: [],
        hiddenChecks: [],
        unconditionalOperations: [],
      },
    });
    expect(mock.requests).toHaveLength(0);
  });

  it("narrates only from player-safe committed data", async () => {
    const mock = queuedClient([{ narration: "You find a folded letter beneath the blotter." }]);
    const result = await narratePlayerSafeConversation(mock.client, {
      message: "I search the desk.",
      viewpointPlan,
      execution: { state: "completed" },
      outcomes: [
        {
          order: 1,
          finalProbability: probability(6_100, "even"),
          grade: "success_with_consequence",
          rollBasisPoints: 4_321,
          summary: "The search finds the letter.",
        },
      ],
      visibleCommittedFacts: [committedFact],
    });

    expect(result.data.narration).toContain("folded letter");
    expect(mock.requests[0]!.prompt).not.toContain(hiddenFact.claim);
    expect(mock.requests[0]!.prompt).not.toContain("hiddenFactors");
    expect(mock.requests[0]!.prompt).not.toContain("I search the desk.");
    expect(mock.requests[0]!.prompt).not.toContain("Find useful evidence.");
    expect(mock.requests[0]!.prompt).not.toContain("Find nothing useful.");
    expect(mock.requests[0]!.prompt).toContain("The search finds the letter.");

    await expect(
      narratePlayerSafeConversation(queuedClient([]).client, {
        message: "I search the desk.",
        viewpointPlan,
        execution: { state: "completed" },
        outcomes: [
          {
            order: 1,
            finalProbability: probability(6_100, "even"),
            grade: "success_with_consequence",
            rollBasisPoints: 4_321,
            summary: "The search finds the letter.",
          },
        ],
        visibleCommittedFacts: [hiddenFact],
      }),
    ).rejects.toBeDefined();
  });
});
