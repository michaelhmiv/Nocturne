import { z } from "zod";
import { ConversationMessageRequestSchema } from "./action.js";
import {
  ConversationStateOperationSchema,
  MAX_STATE_OPERATIONS,
  OutcomeGradeSchema,
  outcomeGradeForMarginBasisPoints,
} from "./resolution.js";

export const MAX_CONVERSATION_CHECKS = 8;
export const MAX_CONVERSATION_FACTS = 24;
export const MAX_CONVERSATION_HISTORY_ENTRIES = 100;

const OpaqueIdSchema = z.string().trim().min(1).max(128);
const TextSchema = z.string().trim().min(1).max(2_000);
const BasisPointsSchema = z.number().int().min(0).max(10_000);

export const InternalIntentKindSchema = z.enum([
  "world_action",
  "question",
  "dialogue",
  "character_creation",
  "out_of_character",
]);

export const InternalIntentSchema = z
  .object({ kind: InternalIntentKindSchema, summary: TextSchema })
  .strict();

export const FactProvenanceSchema = z
  .object({
    kind: z.enum([
      "world_state",
      "character_state",
      "prior_event",
      "content_definition",
      "gm_inference",
    ]),
    sourceId: OpaqueIdSchema,
  })
  .strict();

export const FactValiditySchema = z
  .object({
    state: z.enum(["valid", "superseded", "disputed"]),
    validFromTurn: z.number().int().min(0).max(1_000_000_000),
    validUntilTurn: z.number().int().min(0).max(1_000_000_000).optional(),
  })
  .strict()
  .refine(
    ({ validFromTurn, validUntilTurn }) =>
      validUntilTurn === undefined || validUntilTurn >= validFromTurn,
    "Validity window must not end before it starts",
  );

const FactValueSchema = z.union([
  z.string().max(2_000),
  z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000),
  z.boolean(),
]);

const fact = {
  factId: OpaqueIdSchema,
  claim: TextSchema,
  value: FactValueSchema,
  validity: FactValiditySchema,
  provenance: FactProvenanceSchema,
  viewpointId: OpaqueIdSchema,
};

export const PublicFactReferenceSchema = z
  .object({ ...fact, visibility: z.literal("player_known") })
  .strict();
export const HiddenFactReferenceSchema = z
  .object({ ...fact, visibility: z.literal("authoritative_hidden") })
  .strict();
export const FactReferenceSchema = z.discriminatedUnion("visibility", [
  PublicFactReferenceSchema,
  HiddenFactReferenceSchema,
]);

export const ProbabilityBandSchema = z.enum([
  "impossible",
  "remote",
  "unlikely",
  "even",
  "likely",
  "near_certain",
  "certain",
]);

const probabilityRanges: Record<z.infer<typeof ProbabilityBandSchema>, [number, number]> = {
  impossible: [0, 0],
  remote: [1, 999],
  unlikely: [1_000, 3_499],
  even: [3_500, 6_499],
  likely: [6_500, 8_999],
  near_certain: [9_000, 9_999],
  certain: [10_000, 10_000],
};

export const NocturneProbabilitySchema = z
  .object({
    scale: z.literal("nocturne-probability-v1"),
    band: ProbabilityBandSchema,
    basisPoints: BasisPointsSchema,
  })
  .strict()
  .refine(({ band, basisPoints }) => {
    const [minimum, maximum] = probabilityRanges[band];
    return basisPoints >= minimum && basisPoints <= maximum;
  }, "Probability basis points must refine the declared band");

export const CheckFactorSchema = z
  .object({
    summary: TextSchema,
    probabilityDeltaBasisPoints: z.number().int().min(-10_000).max(10_000),
    citations: z.array(OpaqueIdSchema).min(1).max(4),
  })
  .strict();
export const PublicCheckFactorSchema = CheckFactorSchema;

export const CheckStakesSchema = z.object({ success: TextSchema, failure: TextSchema }).strict();

export const ViewpointConversationCheckSchema = z
  .object({
    order: z.number().int().positive().max(MAX_CONVERSATION_CHECKS),
    label: z.string().trim().min(1).max(300),
    apparentProbability: NocturneProbabilitySchema,
    publicFactors: z.array(PublicCheckFactorSchema).max(8),
    stakes: CheckStakesSchema,
  })
  .strict();

const ordered = <T extends z.ZodType<{ order: number }>>(item: T) =>
  z
    .array(item)
    .max(MAX_CONVERSATION_CHECKS)
    .superRefine((items, context) => {
      items.forEach(({ order }, index) => {
        if (order !== index + 1) {
          context.addIssue({
            code: "custom",
            message: "Items must be ordered consecutively from 1",
            path: [index, "order"],
          });
        }
      });
    });

const uniqueFacts = <T extends z.ZodType<{ factId: string }>>(item: T) =>
  z
    .array(item)
    .max(MAX_CONVERSATION_FACTS)
    .refine(
      (items) => new Set(items.map(({ factId }) => factId)).size === items.length,
      "Fact IDs must be unique",
    );

function validateFactorCitations(
  factors: { citations: string[] }[],
  knownFactIds: Set<string>,
  context: z.RefinementCtx,
  path: (string | number)[],
) {
  factors.forEach((factor, factorIndex) =>
    factor.citations.forEach((factId, citationIndex) => {
      if (!knownFactIds.has(factId)) {
        context.addIssue({
          code: "custom",
          message: "Citations must reference a declared fact ID",
          path: [...path, factorIndex, "citations", citationIndex],
        });
      }
    }),
  );
}

export const ViewpointConversationPlanSchema = z
  .object({
    intent: InternalIntentSchema,
    facts: uniqueFacts(PublicFactReferenceSchema),
    checks: ordered(ViewpointConversationCheckSchema),
  })
  .strict()
  .superRefine((plan, context) => {
    if (
      ["question", "dialogue", "out_of_character"].includes(plan.intent.kind) &&
      plan.checks.length !== 0
    ) {
      context.addIssue({
        code: "custom",
        message: `${plan.intent.kind} intents cannot contain decorative checks`,
        path: ["checks"],
      });
    }
    const known = new Set(plan.facts.map(({ factId }) => factId));
    plan.checks.forEach((check, checkIndex) =>
      validateFactorCitations(check.publicFactors, known, context, [
        "checks",
        checkIndex,
        "publicFactors",
      ]),
    );
  });

export const OutcomeOperationBranchSchema = z
  .object({
    outcomeGrades: z
      .array(OutcomeGradeSchema)
      .min(1)
      .max(6)
      .refine((grades) => new Set(grades).size === grades.length, "Outcome grades must be unique"),
    stateOperations: z.array(ConversationStateOperationSchema).min(1).max(MAX_STATE_OPERATIONS),
  })
  .strict();

const operationBranches = z
  .array(OutcomeOperationBranchSchema)
  .max(6)
  .superRefine((branches, context) => {
    const seen = new Set<string>();
    branches.forEach((branch, branchIndex) =>
      branch.outcomeGrades.forEach((grade, gradeIndex) => {
        if (seen.has(grade)) {
          context.addIssue({
            code: "custom",
            message: "Each outcome grade may select at most one operation branch",
            path: [branchIndex, "outcomeGrades", gradeIndex],
          });
        }
        seen.add(grade);
      }),
    );
  });

export const AuthoritativeCheckAuthorizationSchema = z
  .object({
    order: z.number().int().positive().max(MAX_CONVERSATION_CHECKS),
    hiddenFactors: z.array(CheckFactorSchema).max(8),
    authoritativeProbability: NocturneProbabilitySchema,
    outcomeBranches: operationBranches,
  })
  .strict();

export const AuthoritativeHiddenCheckSchema = z
  .object({
    order: z.number().int().positive().max(MAX_CONVERSATION_CHECKS),
    triggerAfterOrder: z.number().int().min(0).max(MAX_CONVERSATION_CHECKS),
    label: z.string().trim().min(1).max(300),
    probability: NocturneProbabilitySchema,
    hiddenFactors: z.array(CheckFactorSchema).min(1).max(8),
    stakes: CheckStakesSchema,
    outcomeBranches: operationBranches,
  })
  .strict();

export const AuthoritativeConversationPlanSchema = z
  .object({
    viewpointPlan: ViewpointConversationPlanSchema,
    hiddenFacts: uniqueFacts(HiddenFactReferenceSchema),
    checkAuthorizations: ordered(AuthoritativeCheckAuthorizationSchema),
    hiddenChecks: ordered(AuthoritativeHiddenCheckSchema),
    unconditionalOperations: z.array(ConversationStateOperationSchema).max(MAX_STATE_OPERATIONS),
  })
  .strict()
  .superRefine((plan, context) => {
    const facts = [...plan.viewpointPlan.facts, ...plan.hiddenFacts];
    const known = new Set(facts.map(({ factId }) => factId));
    const hidden = new Set(plan.hiddenFacts.map(({ factId }) => factId));
    if (
      ["question", "dialogue", "out_of_character"].includes(plan.viewpointPlan.intent.kind) &&
      (plan.hiddenChecks.length > 0 || plan.unconditionalOperations.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Non-action intents cannot authorize hidden checks or state operations",
        path: ["viewpointPlan", "intent", "kind"],
      });
    }
    if (
      plan.unconditionalOperations.length > 0 &&
      (plan.viewpointPlan.checks.length > 0 || plan.hiddenChecks.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Unconditional operations are only valid for plans with no checks",
        path: ["unconditionalOperations"],
      });
    }
    if (known.size !== facts.length || facts.length > MAX_CONVERSATION_FACTS) {
      context.addIssue({
        code: "custom",
        message: "All authoritative fact IDs must be unique and bounded",
        path: ["hiddenFacts"],
      });
    }
    if (plan.checkAuthorizations.length !== plan.viewpointPlan.checks.length) {
      context.addIssue({
        code: "custom",
        message: "Every viewpoint check requires exactly one authoritative authorization",
        path: ["checkAuthorizations"],
      });
    }
    plan.checkAuthorizations.forEach((authorization, index) => {
      if (authorization.order !== plan.viewpointPlan.checks[index]?.order) {
        context.addIssue({
          code: "custom",
          message: "Authoritative checks must preserve viewpoint check order",
          path: ["checkAuthorizations", index, "order"],
        });
      }
      validateFactorCitations(authorization.hiddenFactors, hidden, context, [
        "checkAuthorizations",
        index,
        "hiddenFactors",
      ]);
      const apparentProbability = plan.viewpointPlan.checks[index]?.apparentProbability;
      const expectedBasisPoints = apparentProbability
        ? Math.max(
            0,
            Math.min(
              10_000,
              apparentProbability.basisPoints +
                authorization.hiddenFactors.reduce(
                  (total, factor) => total + factor.probabilityDeltaBasisPoints,
                  0,
                ),
            ),
          )
        : undefined;
      if (
        expectedBasisPoints !== undefined &&
        authorization.authoritativeProbability.basisPoints !== expectedBasisPoints
      ) {
        context.addIssue({
          code: "custom",
          message:
            "Authoritative probability must equal the apparent probability plus hidden deltas",
          path: ["checkAuthorizations", index, "authoritativeProbability"],
        });
      }
    });
    plan.hiddenChecks.forEach((check, index) => {
      if (index > 0 && check.triggerAfterOrder < plan.hiddenChecks[index - 1]!.triggerAfterOrder) {
        context.addIssue({
          code: "custom",
          message: "Hidden check triggers must be nondecreasing",
          path: ["hiddenChecks", index, "triggerAfterOrder"],
        });
      }
      if (check.triggerAfterOrder > plan.viewpointPlan.checks.length) {
        context.addIssue({
          code: "custom",
          message: "Hidden check trigger must reference a completed viewpoint-check prefix",
          path: ["hiddenChecks", index, "triggerAfterOrder"],
        });
      }
      validateFactorCitations(check.hiddenFactors, hidden, context, [
        "hiddenChecks",
        index,
        "hiddenFactors",
      ]);
    });
    const operationGroups: {
      operations: (typeof plan.unconditionalOperations)[number][];
      path: (string | number)[];
    }[] = [
      { operations: plan.unconditionalOperations, path: ["unconditionalOperations"] },
      ...plan.checkAuthorizations.flatMap((authorization, authorizationIndex) =>
        authorization.outcomeBranches.map((branch, branchIndex) => ({
          operations: branch.stateOperations,
          path: [
            "checkAuthorizations",
            authorizationIndex,
            "outcomeBranches",
            branchIndex,
            "stateOperations",
          ],
        })),
      ),
      ...plan.hiddenChecks.flatMap((check, checkIndex) =>
        check.outcomeBranches.map((branch, branchIndex) => ({
          operations: branch.stateOperations,
          path: ["hiddenChecks", checkIndex, "outcomeBranches", branchIndex, "stateOperations"],
        })),
      ),
    ];
    if (
      operationGroups.reduce((total, group) => total + group.operations.length, 0) >
      MAX_STATE_OPERATIONS
    ) {
      context.addIssue({
        code: "custom",
        message: "The authoritative plan contains too many state operations",
        path: ["unconditionalOperations"],
      });
    }
    operationGroups.forEach(({ operations, path }) =>
      operations.forEach((operation, operationIndex) =>
        operation.preconditionFactIds.forEach((factId, factIndex) => {
          if (!known.has(factId)) {
            context.addIssue({
              code: "custom",
              message: "Operation preconditions must reference a declared fact ID",
              path: [...path, operationIndex, "preconditionFactIds", factIndex],
            });
          }
        }),
      ),
    );
  });

export const CheckOutcomeSchema = z
  .object({
    order: z.number().int().positive().max(MAX_CONVERSATION_CHECKS),
    finalProbability: NocturneProbabilitySchema,
    grade: OutcomeGradeSchema,
    rollBasisPoints: z.number().int().min(1).max(10_000).nullable(),
    summary: TextSchema,
  })
  .strict();

const outcomes = ordered(CheckOutcomeSchema);

export const ConversationExecutionSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("completed") }).strict(),
  z
    .object({
      state: z.literal("stopped"),
      stoppedAfterOrder: z.number().int().positive().max(MAX_CONVERSATION_CHECKS),
    })
    .strict(),
]);

function outcomesMatchChecks(
  outcomeValues: {
    order: number;
    finalProbability: { scale: string; band: string; basisPoints: number };
    grade: z.infer<typeof OutcomeGradeSchema>;
    rollBasisPoints?: number | null;
  }[],
  checks: {
    order: number;
    probability: { scale: string; band: string; basisPoints: number };
  }[],
  context: z.RefinementCtx,
  path: string,
  exact = true,
) {
  if (
    (exact && outcomeValues.length !== checks.length) ||
    outcomeValues.length > checks.length ||
    outcomeValues.some(({ order }, index) => order !== checks[index]?.order)
  ) {
    context.addIssue({
      code: "custom",
      message: exact
        ? "Outcomes must correspond exactly to executed checks"
        : "Outcomes must be a consecutive prefix of meaningful checks",
      path: [path],
    });
  }
  outcomeValues.forEach((outcome, index) => {
    const expected = checks[index]?.probability;
    if (!expected) return;
    if (
      outcome.finalProbability.scale !== expected.scale ||
      outcome.finalProbability.band !== expected.band ||
      outcome.finalProbability.basisPoints !== expected.basisPoints
    ) {
      context.addIssue({
        code: "custom",
        message: "Outcome final probability must match the authoritative check probability",
        path: [path, index, "finalProbability"],
      });
    }
    const basisPoints = outcome.finalProbability.basisPoints;
    const terminal = basisPoints === 0 || basisPoints === 10_000;
    if (
      (terminal && outcome.rollBasisPoints !== null) ||
      (!terminal && outcome.rollBasisPoints === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Terminal probabilities omit a roll; uncertain probabilities require one",
        path: [path, index, "rollBasisPoints"],
      });
    }
    const expectedGrade = terminal
      ? basisPoints === 10_000
        ? "complete_success"
        : "failure"
      : outcomeGradeForMarginBasisPoints(basisPoints - outcome.rollBasisPoints!);
    if (outcome.grade !== expectedGrade) {
      context.addIssue({
        code: "custom",
        message: "Outcome grade must match the authoritative probability and roll",
        path: [path, index, "grade"],
      });
    }
  });
}

function validateExecution(
  execution: z.infer<typeof ConversationExecutionSchema>,
  outcomeValues: { order: number }[],
  checkCount: number,
  context: z.RefinementCtx,
) {
  if (execution.state === "completed" && outcomeValues.length !== checkCount) {
    context.addIssue({
      code: "custom",
      message: "Completed execution requires outcomes for every planned check",
      path: ["execution"],
    });
  }
  if (
    execution.state === "stopped" &&
    (outcomeValues.length === 0 ||
      outcomeValues.length >= checkCount ||
      outcomeValues.at(-1)?.order !== execution.stoppedAfterOrder)
  ) {
    context.addIssue({
      code: "custom",
      message: "Stopped execution must identify the last outcome in a strict check prefix",
      path: ["execution"],
    });
  }
}

export const AuthoritativeConversationResponseSchema = z
  .object({
    responseId: OpaqueIdSchema,
    narration: z.string().trim().min(1).max(8_000),
    plan: AuthoritativeConversationPlanSchema,
    execution: ConversationExecutionSchema,
    outcomes,
    hiddenOutcomes: outcomes,
  })
  .strict()
  .superRefine((value, context) => {
    outcomesMatchChecks(
      value.outcomes,
      value.plan.checkAuthorizations.map((check) => ({
        order: check.order,
        probability: check.authoritativeProbability,
      })),
      context,
      "outcomes",
      false,
    );
    validateExecution(
      value.execution,
      value.outcomes,
      value.plan.checkAuthorizations.length,
      context,
    );
    const completedOrder = value.outcomes.at(-1)?.order ?? 0;
    outcomesMatchChecks(
      value.hiddenOutcomes,
      value.plan.hiddenChecks
        .filter((check) => check.triggerAfterOrder <= completedOrder)
        .map((check) => ({ order: check.order, probability: check.probability })),
      context,
      "hiddenOutcomes",
    );
  });

export const PlayerSafeConversationResponseSchema = z
  .object({
    responseId: OpaqueIdSchema,
    narration: z.string().trim().min(1).max(8_000),
    plan: ViewpointConversationPlanSchema,
    execution: ConversationExecutionSchema,
    outcomes,
  })
  .strict()
  .superRefine((value, context) => {
    outcomesMatchChecks(
      value.outcomes,
      value.plan.checks.map((check, index) => ({
        order: check.order,
        probability: value.outcomes[index]?.finalProbability ?? check.apparentProbability,
      })),
      context,
      "outcomes",
      false,
    );
    validateExecution(value.execution, value.outcomes, value.plan.checks.length, context);
  });

export const AuthoritativeConversationHistoryEntrySchema = z
  .object({
    request: ConversationMessageRequestSchema,
    response: AuthoritativeConversationResponseSchema,
  })
  .strict();
export const PlayerSafeConversationHistoryEntrySchema = z
  .object({
    request: ConversationMessageRequestSchema,
    response: PlayerSafeConversationResponseSchema,
  })
  .strict();
export const AuthoritativeConversationHistorySchema = z
  .array(AuthoritativeConversationHistoryEntrySchema)
  .max(MAX_CONVERSATION_HISTORY_ENTRIES);
export const PlayerSafeConversationHistorySchema = z
  .array(PlayerSafeConversationHistoryEntrySchema)
  .max(MAX_CONVERSATION_HISTORY_ENTRIES);

// Transition aliases retained until frontend/API migration.
export const ConversationPlanSchema = ViewpointConversationPlanSchema;
export const ProposedConversationCheckSchema = ViewpointConversationCheckSchema;
export const AuthoritativeConversationCheckSchema = AuthoritativeCheckAuthorizationSchema;
export const PlayerSafeConversationCheckSchema = ViewpointConversationCheckSchema;

export type InternalIntent = z.infer<typeof InternalIntentSchema>;
export type FactReference = z.infer<typeof FactReferenceSchema>;
export type ProposedConversationCheck = z.infer<typeof ViewpointConversationCheckSchema>;
export type ViewpointConversationPlan = z.infer<typeof ViewpointConversationPlanSchema>;
export type AuthoritativeConversationPlan = z.infer<typeof AuthoritativeConversationPlanSchema>;
export type ConversationPlan = ViewpointConversationPlan;
export type AuthoritativeConversationResponse = z.infer<
  typeof AuthoritativeConversationResponseSchema
>;
export type PlayerSafeConversationResponse = z.infer<typeof PlayerSafeConversationResponseSchema>;
