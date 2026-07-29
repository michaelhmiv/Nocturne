import { describe, expect, it } from "vitest";
import {
  AuthoritativeConversationHistoryEntrySchema,
  AuthoritativeConversationPlanSchema,
  AuthoritativeConversationResponseSchema,
  ConversationMessageRequestSchema,
  MAX_CONVERSATION_CHECKS,
  MAX_CONVERSATION_FACTS,
  MAX_CONVERSATION_HISTORY_ENTRIES,
  MAX_STATE_OPERATIONS,
  PlayerSafeConversationHistoryEntrySchema,
  PlayerSafeConversationHistorySchema,
  PlayerSafeConversationResponseSchema,
  ViewpointConversationPlanSchema,
} from "../src/index.js";

const probability = (basisPoints: number, band = "likely") => ({
  scale: "nocturne-probability-v1",
  band,
  basisPoints,
});

const publicFact = {
  factId: "fact:room:dust",
  claim: "Dust outlines show that the desk drawer was recently opened.",
  value: true,
  validity: { state: "valid", validFromTurn: 1 },
  provenance: { kind: "world_state", sourceId: "room:library" },
  viewpointId: "character:ada",
  visibility: "player_known",
} as const;

const hiddenFact = {
  factId: "fact:room:hidden-switch",
  claim: "The portrait release is wired to a quiet alarm.",
  value: "quiet_alarm",
  validity: { state: "valid", validFromTurn: 1, validUntilTurn: 20 },
  provenance: { kind: "gm_inference", sourceId: "secret:library-panel" },
  viewpointId: "character:ada",
  visibility: "authoritative_hidden",
} as const;

const check = (order: number) => ({
  order,
  label: `Search location ${order}`,
  apparentProbability: probability(7200),
  publicFactors: [
    {
      summary: "Visible dust helps the search.",
      probabilityDeltaBasisPoints: 800,
      citations: [publicFact.factId],
    },
  ],
  stakes: { success: "Find useful evidence.", failure: "Lose time." },
});

const viewpointPlan = {
  intent: { kind: "world_action", summary: "Search the library." },
  facts: [publicFact],
  checks: [check(1)],
};

const successfulOperations = [
  {
    type: "create_information_asset" as const,
    preconditionFactIds: [publicFact.factId],
    holderId: "character:ada",
    content: "A letter names the midnight courier.",
    confidenceBasisPoints: 10_000,
    truthStatus: "observation" as const,
  },
  {
    type: "set_condition" as const,
    preconditionFactIds: [hiddenFact.factId],
    entityId: "room:library",
    condition: "quiet_alarm",
    active: true,
  },
];

const authoritativePlan = {
  viewpointPlan,
  hiddenFacts: [hiddenFact],
  checkAuthorizations: [
    {
      order: 1,
      hiddenFactors: [
        {
          summary: "The release is deliberately disguised.",
          probabilityDeltaBasisPoints: -1700,
          citations: [hiddenFact.factId],
        },
      ],
      authoritativeProbability: probability(6100, "even"),
      outcomeBranches: [
        {
          outcomeGrades: ["complete_success" as const],
          stateOperations: successfulOperations,
        },
      ],
    },
  ],
  hiddenChecks: [],
  unconditionalOperations: [],
};

const outcome = {
  order: 1,
  grade: "complete_success",
  rollBasisPoints: 4021,
  summary: "The letter is recovered.",
} as const;

const authoritativeResponse = {
  responseId: "response:search-library",
  narration: "The desk yields a folded letter.",
  plan: authoritativePlan,
  outcomes: [outcome],
  hiddenOutcomes: [],
};

const playerSafeResponse = {
  responseId: authoritativeResponse.responseId,
  narration: authoritativeResponse.narration,
  plan: viewpointPlan,
  outcomes: [outcome],
};

describe("conversation contracts", () => {
  it("accepts only one bounded natural-language message", () => {
    expect(ConversationMessageRequestSchema.safeParse({ message: "x" }).success).toBe(true);
    expect(ConversationMessageRequestSchema.safeParse({ message: "x".repeat(4_000) }).success).toBe(
      true,
    );
    expect(ConversationMessageRequestSchema.safeParse({ message: "   " }).success).toBe(false);
    expect(ConversationMessageRequestSchema.safeParse({ message: "x".repeat(4_001) }).success).toBe(
      false,
    );
    expect(
      ConversationMessageRequestSchema.safeParse({ message: "Search.", actorId: "spoofed" })
        .success,
    ).toBe(false);
  });

  it.each(["question", "dialogue", "out_of_character"])(
    "requires no decorative roll for %s",
    (kind) => {
      const plan = {
        intent: { kind, summary: "No uncertain world action occurs." },
        facts: [],
        checks: [],
      };
      expect(ViewpointConversationPlanSchema.safeParse(plan).success).toBe(true);
      expect(
        ViewpointConversationPlanSchema.safeParse({ ...plan, checks: [check(1)] }).success,
      ).toBe(false);
    },
  );

  it("enforces zero and maximum collection boundaries", () => {
    const maximum = {
      ...viewpointPlan,
      facts: Array.from({ length: MAX_CONVERSATION_FACTS }, (_, index) => ({
        ...publicFact,
        factId: `fact:${index}`,
      })),
      checks: Array.from({ length: MAX_CONVERSATION_CHECKS }, (_, index) => ({
        ...check(index + 1),
        publicFactors: [],
      })),
    };
    expect(ViewpointConversationPlanSchema.safeParse(maximum).success).toBe(true);
    expect(
      ViewpointConversationPlanSchema.safeParse({
        ...maximum,
        facts: [...maximum.facts, { ...publicFact, factId: "fact:overflow" }],
      }).success,
    ).toBe(false);
    expect(
      ViewpointConversationPlanSchema.safeParse({
        ...maximum,
        checks: [...maximum.checks, { ...check(9), publicFactors: [] }],
      }).success,
    ).toBe(false);
  });

  it("uses versioned, band-refined integer basis-point probabilities", () => {
    expect(ViewpointConversationPlanSchema.safeParse(viewpointPlan).success).toBe(true);
    for (const [basisPoints, band] of [
      [0, "impossible"],
      [1, "remote"],
      [999, "remote"],
      [1_000, "unlikely"],
      [3_499, "unlikely"],
      [3_500, "even"],
      [6_499, "even"],
      [6_500, "likely"],
      [8_999, "likely"],
      [9_000, "near_certain"],
      [9_999, "near_certain"],
      [10_000, "certain"],
    ] as const) {
      const candidate = structuredClone(viewpointPlan);
      candidate.checks[0]!.apparentProbability = probability(basisPoints, band);
      expect(ViewpointConversationPlanSchema.safeParse(candidate).success).toBe(true);
    }
    for (const malformed of [
      probability(12.5),
      probability(-1),
      probability(10_001),
      probability(7200, "impossible"),
      { ...probability(7200), scale: "spoofed" },
    ]) {
      const candidate = structuredClone(viewpointPlan);
      candidate.checks[0]!.apparentProbability = malformed;
      expect(ViewpointConversationPlanSchema.safeParse(candidate).success).toBe(false);
    }
  });

  it("requires bounded viewpoint facts and opaque declared fact-ID citations", () => {
    expect(ViewpointConversationPlanSchema.safeParse(viewpointPlan).success).toBe(true);

    const unknown = structuredClone(viewpointPlan);
    (unknown.checks[0]!.publicFactors[0]!.citations as string[]) = ["fact:unknown"];
    expect(ViewpointConversationPlanSchema.safeParse(unknown).success).toBe(false);

    const spoofed = structuredClone(viewpointPlan) as any;
    spoofed.checks[0].publicFactors[0].citations = [{ ...hiddenFact, factId: publicFact.factId }];
    expect(ViewpointConversationPlanSchema.safeParse(spoofed).success).toBe(false);

    for (const mutation of [
      { ...publicFact, claim: "x".repeat(2_001) },
      { ...publicFact, value: "x".repeat(2_001) },
      { ...publicFact, factId: "x".repeat(129) },
      { ...publicFact, validity: { state: "valid", validFromTurn: 2, validUntilTurn: 1 } },
      { ...publicFact, visibility: "authoritative_hidden" },
    ]) {
      expect(
        ViewpointConversationPlanSchema.safeParse({ ...viewpointPlan, facts: [mutation] }).success,
      ).toBe(false);
    }
  });

  it("keeps the two passes structurally separate and preserves the viewpoint pass", () => {
    const parsed = AuthoritativeConversationPlanSchema.parse(authoritativePlan);
    expect(parsed.viewpointPlan).toEqual(ViewpointConversationPlanSchema.parse(viewpointPlan));
    expect((parsed.viewpointPlan.checks[0] as any).authoritativeProbability).toBeUndefined();
    expect((parsed.viewpointPlan.checks[0] as any).hiddenFactors).toBeUndefined();

    expect(
      ViewpointConversationPlanSchema.safeParse({
        ...viewpointPlan,
        hiddenFacts: [hiddenFact],
      }).success,
    ).toBe(false);
    expect(
      AuthoritativeConversationPlanSchema.safeParse({
        ...authoritativePlan,
        checkAuthorizations: [],
      }).success,
    ).toBe(false);

    const publicCitation = structuredClone(authoritativePlan);
    (publicCitation.checkAuthorizations[0]!.hiddenFactors[0]!.citations as string[]) = [
      publicFact.factId,
    ];
    expect(AuthoritativeConversationPlanSchema.safeParse(publicCitation).success).toBe(false);

    const unexplainedAdjustment = structuredClone(authoritativePlan);
    unexplainedAdjustment.checkAuthorizations[0]!.hiddenFactors = [];
    expect(AuthoritativeConversationPlanSchema.safeParse(unexplainedAdjustment).success).toBe(
      false,
    );

    const unchanged = structuredClone(authoritativePlan);
    unchanged.checkAuthorizations[0]!.hiddenFactors = [];
    unchanged.checkAuthorizations[0]!.authoritativeProbability =
      unchanged.viewpointPlan.checks[0]!.apparentProbability;
    expect(AuthoritativeConversationPlanSchema.safeParse(unchanged).success).toBe(true);
  });

  it("binds operations to no-roll messages or explicit check outcomes", () => {
    const base = authoritativePlan;
    const stateOperations = successfulOperations;
    const branched = {
      ...base,
      checkAuthorizations: [
        {
          ...base.checkAuthorizations[0],
          outcomeBranches: [
            {
              outcomeGrades: ["complete_success"],
              stateOperations,
            },
          ],
        },
      ],
      unconditionalOperations: [],
    };
    expect(AuthoritativeConversationPlanSchema.safeParse(branched).success).toBe(true);
    expect(
      AuthoritativeConversationPlanSchema.safeParse({
        ...branched,
        stateOperations,
      }).success,
    ).toBe(false);
  });

  it("keeps separately rolled hidden reactions in authoritative audit only", () => {
    const hiddenCheck = {
      order: 1,
      triggerAfterOrder: 1,
      label: "Quiet alarm reaction",
      probability: probability(3_000, "unlikely"),
      hiddenFactors: [
        {
          summary: "The release is wired to an alarm.",
          probabilityDeltaBasisPoints: 0,
          citations: [hiddenFact.factId],
        },
      ],
      stakes: { success: "The alarm fires.", failure: "The alarm remains quiet." },
      outcomeBranches: [],
    };
    const authoritativeOnly = {
      ...authoritativeResponse,
      plan: { ...authoritativePlan, hiddenChecks: [hiddenCheck] },
      hiddenOutcomes: [{ ...outcome, rollBasisPoints: 2_000 }],
    };

    expect(AuthoritativeConversationResponseSchema.safeParse(authoritativeOnly).success).toBe(true);
    expect(
      PlayerSafeConversationResponseSchema.safeParse({
        ...playerSafeResponse,
        hiddenChecks: [hiddenCheck],
      }).success,
    ).toBe(false);
    expect(
      PlayerSafeConversationResponseSchema.safeParse({
        ...playerSafeResponse,
        hiddenOutcomes: authoritativeOnly.hiddenOutcomes,
      }).success,
    ).toBe(false);
  });

  it("validates bounded operation preconditions and the minimum generic families", () => {
    const genericOperations = [
      {
        type: "create_definition",
        preconditionFactIds: [],
        definitionId: "definition:clue",
        definitionKind: "clue",
        name: "Courier letter",
      },
      {
        type: "create_revision",
        preconditionFactIds: [hiddenFact.factId],
        revisionId: "revision:clue:2",
        definitionId: "definition:clue",
        patch: "The seal is identified.",
      },
      {
        type: "create_instance",
        preconditionFactIds: [publicFact.factId],
        instanceId: "instance:letter",
        definitionId: "definition:clue",
        name: "Folded letter",
      },
      {
        type: "acquire_entity",
        preconditionFactIds: [publicFact.factId],
        ownerId: "character:ada",
        entityId: "instance:letter",
      },
      {
        type: "move_entity",
        preconditionFactIds: [publicFact.factId],
        entityId: "character:ada",
        locationId: "room:library",
      },
      {
        type: "set_relationship",
        preconditionFactIds: [publicFact.factId],
        sourceId: "character:ada",
        targetId: "npc:curator",
        relationship: "trust",
        value: 10,
      },
      {
        type: "set_access",
        preconditionFactIds: [publicFact.factId],
        subjectId: "character:ada",
        resourceId: "room:archive",
        access: "grant",
      },
      {
        type: "adjust_resource",
        preconditionFactIds: [publicFact.factId],
        entityId: "character:ada",
        resource: "focus",
        delta: -1,
      },
      {
        type: "schedule_timed_work",
        preconditionFactIds: [publicFact.factId],
        workerId: "character:ada",
        workId: "work:decode-letter",
        description: "Decode the courier's cipher.",
        durationSeconds: 3_600,
      },
      {
        type: "apply_area_effect",
        preconditionFactIds: [hiddenFact.factId],
        areaId: "room:library",
        effect: "smoke",
        active: true,
        durationSeconds: 60,
      },
    ];
    expect(
      AuthoritativeConversationPlanSchema.safeParse({
        ...authoritativePlan,
        checkAuthorizations: authoritativePlan.checkAuthorizations.map((authorization) => ({
          ...authorization,
          outcomeBranches: [],
        })),
        unconditionalOperations: genericOperations,
      }).success,
    ).toBe(true);

    const unknown = {
      ...authoritativePlan,
      unconditionalOperations: [{ ...genericOperations[0], preconditionFactIds: ["fact:unknown"] }],
    };
    expect(AuthoritativeConversationPlanSchema.safeParse(unknown).success).toBe(false);
    expect(
      AuthoritativeConversationPlanSchema.safeParse({
        ...authoritativePlan,
        unconditionalOperations: [{ type: "invent_new_workflow", preconditionFactIds: [] }],
      }).success,
    ).toBe(false);

    const maximum = {
      ...authoritativePlan,
      checkAuthorizations: authoritativePlan.checkAuthorizations.map((authorization) => ({
        ...authorization,
        outcomeBranches: [],
      })),
      unconditionalOperations: Array.from(
        { length: MAX_STATE_OPERATIONS },
        () => genericOperations[0],
      ),
    };
    expect(AuthoritativeConversationPlanSchema.safeParse(maximum).success).toBe(true);
    expect(
      AuthoritativeConversationPlanSchema.safeParse({
        ...maximum,
        unconditionalOperations: [...maximum.unconditionalOperations, genericOperations[0]],
      }).success,
    ).toBe(false);
  });

  it("makes authoritative-only fields impossible in player-safe output", () => {
    expect(AuthoritativeConversationResponseSchema.safeParse(authoritativeResponse).success).toBe(
      true,
    );
    expect(PlayerSafeConversationResponseSchema.safeParse(playerSafeResponse).success).toBe(true);
    for (const leak of [
      { ...playerSafeResponse, plan: { ...viewpointPlan, hiddenFacts: [hiddenFact] } },
      { ...playerSafeResponse, plan: authoritativePlan },
      { ...playerSafeResponse, authoritativeProbability: probability(6100) },
      {
        ...playerSafeResponse,
        hiddenFactors: authoritativePlan.checkAuthorizations[0]!.hiddenFactors,
      },
      { ...playerSafeResponse, unconditionalOperations: successfulOperations },
    ]) {
      expect(PlayerSafeConversationResponseSchema.safeParse(leak).success).toBe(false);
    }
  });

  it("bounds response narration, rolls, outcomes, and history", () => {
    expect(
      AuthoritativeConversationResponseSchema.safeParse({
        ...authoritativeResponse,
        narration: "x".repeat(8_000),
      }).success,
    ).toBe(true);
    expect(
      AuthoritativeConversationResponseSchema.safeParse({
        ...authoritativeResponse,
        narration: "x".repeat(8_001),
      }).success,
    ).toBe(false);
    for (const rollBasisPoints of [1, 10_000]) {
      expect(
        AuthoritativeConversationResponseSchema.safeParse({
          ...authoritativeResponse,
          outcomes: [{ ...outcome, rollBasisPoints }],
        }).success,
      ).toBe(true);
    }
    for (const rollBasisPoints of [null, 0, 10_001]) {
      expect(
        AuthoritativeConversationResponseSchema.safeParse({
          ...authoritativeResponse,
          outcomes: [{ ...outcome, rollBasisPoints }],
        }).success,
      ).toBe(false);
    }

    const terminal = {
      ...authoritativeResponse,
      plan: {
        ...authoritativePlan,
        checkAuthorizations: [
          {
            ...authoritativePlan.checkAuthorizations[0],
            authoritativeProbability: probability(10_000, "certain"),
          },
        ],
      },
      outcomes: [{ ...outcome, rollBasisPoints: null }],
    };
    expect(AuthoritativeConversationResponseSchema.safeParse(terminal).success).toBe(true);
    expect(
      AuthoritativeConversationResponseSchema.safeParse({
        ...terminal,
        outcomes: [{ ...outcome, rollBasisPoints: 5_000 }],
      }).success,
    ).toBe(false);

    const request = { message: "Search the library." };
    expect(
      AuthoritativeConversationHistoryEntrySchema.safeParse({
        request,
        response: authoritativeResponse,
      }).success,
    ).toBe(true);
    expect(
      PlayerSafeConversationHistoryEntrySchema.safeParse({ request, response: playerSafeResponse })
        .success,
    ).toBe(true);
    const entry = { request, response: playerSafeResponse };

    expect(
      PlayerSafeConversationHistorySchema.safeParse(
        Array.from({ length: MAX_CONVERSATION_HISTORY_ENTRIES }, () => entry),
      ).success,
    ).toBe(true);
    expect(
      PlayerSafeConversationHistorySchema.safeParse(
        Array.from({ length: MAX_CONVERSATION_HISTORY_ENTRIES + 1 }, () => entry),
      ).success,
    ).toBe(false);
  });
});
