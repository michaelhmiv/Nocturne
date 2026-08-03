import { describe, expect, it } from "vitest";
import {
  AuthoritativeConversationPlanSchema,
  ConversationActionResponseSchema,
  ConversationMessageRequestSchema,
  ConversationProbabilityModelSchema,
  ConversationProbabilityRefinementSchema,
  ConversationViewpointPlanSchema,
  createContextFactId,
  HiddenConversationReactionSchema,
  MAX_CONVERSATION_CHECKS,
  MAX_CONVERSATION_OPERATIONS,
  MAX_CONVERSATION_PLAN_STEPS,
  MAX_CONVERSATION_REFERENCES,
  MAX_CONVERSATION_RESOLUTION_BANDS,
  MAX_CONVERSATION_RESPONSE_HISTORY,
  PlayerSafeConversationResponseSchema,
  ProbabilityBandSchema,
  ProbabilityRefinementReasonSchema,
} from "../src/index.js";

const publicFact = {
  factId: createContextFactId("world", "door-1", "locked"),
  visibility: "public" as const,
  content: "The archive door is locked.",
};
const hiddenFact = {
  factId: createContextFactId("world", "guard-1", "distracted"),
  visibility: "hidden" as const,
  content: "The guard is distracted.",
};

const viewpointPlan = {
  policyVersion: "conversation-viewpoint-v1",
  intent: { kind: "world_action" as const, summary: "Open the archive door." },
  references: [
    {
      referenceId: "ref:archive-door",
      rawText: "the archive door",
      entityId: "door:archive",
      resolution: "resolved" as const,
      citedFactIds: [publicFact.factId],
    },
  ],
  plan: {
    summary: "Attempt to open the locked archive door.",
    terminalStepId: "step:open",
    steps: [
      {
        stepId: "step:open",
        rawText: "Open the archive door.",
        actionKind: "interact",
        objective: "Open the archive door.",
        dependsOnPreviousSuccess: false,
        targetEntityIds: ["door:archive"],
        citedFactIds: [publicFact.factId],
      },
    ],
  },
  checks: [
    {
      checkId: "check:open",
      stepId: "step:open",
      reason: "The locked door creates meaningful uncertainty.",
      relevantSkill: "lockpicking",
      citedFactIds: [publicFact.factId],
    },
  ],
  assumptions: [],
};

const probabilityModel = {
  policyVersion: "conversation-probability-v1",
  baseProbabilityBasisPoints: 5000,
  publicRefinement: {
    finalProbabilityBasisPoints: 4500,
    reasons: [
      {
        reasonId: "door-locked",
        deltaBasisPoints: -500,
        explanation: "The archive door is locked.",
        citedFactIds: [publicFact.factId],
      },
    ],
  },
  hiddenRefinement: {
    finalProbabilityBasisPoints: 5500,
    reasons: [
      {
        reasonId: "guard-distracted",
        deltaBasisPoints: 1000,
        explanation: "The distracted guard reduces interference.",
        citedFactIds: [hiddenFact.factId],
      },
    ],
  },
  finalProbabilityBasisPoints: 5500,
  outcomeBands: [
    { grade: "complete_success" as const, minimumRoll: 1, maximumRoll: 1500 },
    { grade: "success_with_consequence" as const, minimumRoll: 1501, maximumRoll: 3500 },
    { grade: "partial_success" as const, minimumRoll: 3501, maximumRoll: 5500 },
    { grade: "failure_with_progress" as const, minimumRoll: 5501, maximumRoll: 7000 },
    { grade: "failure" as const, minimumRoll: 7001, maximumRoll: 9000 },
    { grade: "catastrophic_reversal" as const, minimumRoll: 9001, maximumRoll: 10000 },
  ],
};

const authoritativePlan = {
  policyVersion: "conversation-authoritative-v1",
  viewpointPlan,
  publicFacts: [publicFact],
  hiddenFacts: [hiddenFact],
  checkAuthorizations: [
    {
      checkId: "check:open",
      stepId: "step:open",
      probability: probabilityModel,
      outcomes: {
        complete_success: [],
        success_with_consequence: [],
        partial_success: [],
        failure_with_progress: [],
        failure: [],
        catastrophic_reversal: [],
      },
    },
  ],
  hiddenChecks: [],
  unconditionalOperations: [],
};

// The complete file content remains unchanged except for the typed-resource fixture below.
