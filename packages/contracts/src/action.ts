import { z } from "zod";
import { ConsumptionResultSchema } from "./consumption.js";

export const ConversationMessageRequestSchema = z
  .object({ message: z.string().trim().min(1).max(4_000) })
  .strict();

export const ActionIntentSchema = z.object({
  actorId: z.string().uuid(),
  rawText: z.string().min(1),
  actionType: z.string().min(1),
  targetIds: z.array(z.string()).default([]),
  methodDefinitionIds: z.array(z.string()).default([]),
  objective: z.string().min(1),
  intensity: z.enum(["careful", "normal", "urgent", "maximum"]).default("normal"),
  assumptions: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});

export const ProposedActionModifierSchema = z.object({
  factorId: z.string().min(1),
  value: z.number().int().min(-2).max(2),
  reason: z.string().min(1),
  sourceId: z.string().optional(),
  citedContextFact: z.string().min(1),
});

export const ParsedActionEnvelopeSchema = z.object({
  intent: ActionIntentSchema,
  proposedModifiers: z.array(ProposedActionModifierSchema).max(4).default([]),
  relevantContextFacts: z.array(z.string().min(1)).max(12).default([]),
});

export const ActionPlanStepSchema = z.object({
  stepId: z.string().trim().min(1).max(64),
  rawText: z.string().trim().min(1).max(1_000),
  actionType: z.string().trim().min(1).max(64),
  objective: z.string().trim().min(1).max(500),
  dependsOnPreviousSuccess: z.boolean().default(false),
  targetLocationId: z.string().uuid().optional(),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(6).default([]),
  confidence: z.number().min(0).max(1),
});

export const ActionPlanEnvelopeSchema = z.object({
  summary: z.string().trim().min(1).max(500),
  steps: z.array(ActionPlanStepSchema).min(1).max(8),
  assumptions: z.array(z.string().trim().min(1).max(500)).max(8).default([]),
});

export const SubmitActionRequestSchema = z.object({
  actorId: z.string().uuid(),
  rawText: z.string().trim().min(3).max(4_000),
  methodInstanceId: z.string().uuid().optional(),
  targetLocationId: z.string().uuid().optional(),
});

export const ActionExecutionResponseSchema = z.object({
  eventId: z.string().uuid(),
  intentId: z.string().uuid(),
  resolutionId: z.string().uuid(),
  rawText: z.string(),
  outcomeGrade: z.string(),
  margin: z.number().int(),
  narration: z.string(),
  calculationTrace: z.array(z.string()),
  informationGained: z.array(
    z.object({ informationId: z.string().uuid(), content: z.string(), confidence: z.number() }),
  ),
  costs: z.array(z.object({ resource: z.string(), amount: z.number() })),
  consumption: ConsumptionResultSchema.optional(),
  createdAt: z.string().datetime(),
  idempotentReplay: z.boolean(),
});

export const ActionTravelResultSchema = z.object({
  to: z.string().uuid(),
  path: z.array(z.string().uuid()),
  travelSeconds: z.number().int().nonnegative(),
  scheduled: z.boolean(),
});

export const ActionPlanStepExecutionSchema = z.object({
  stepId: z.string(),
  order: z.number().int().positive(),
  rawText: z.string(),
  actionType: z.string(),
  objective: z.string(),
  dependsOnPreviousSuccess: z.boolean(),
  status: z.enum(["completed", "skipped"]),
  outcomeGrade: z.string().optional(),
  eventId: z.string().uuid().optional(),
  narration: z.string().optional(),
  consumption: ConsumptionResultSchema.optional(),
  travel: ActionTravelResultSchema.optional(),
  skipReason: z.string().optional(),
});

export const ActionPlanExecutionResponseSchema = z.object({
  planId: z.string().min(1),
  rawText: z.string(),
  summary: z.string(),
  overallStatus: z.enum(["complete_success", "partial_success", "failure", "invalid"]),
  steps: z.array(ActionPlanStepExecutionSchema).min(1).max(8),
  narration: z.string(),
  finalState: z.object({
    locationId: z.string().uuid().nullable(),
    actorStatus: z.string(),
    pendingTravelTo: z.string().uuid().nullable(),
  }),
  idempotentReplay: z.boolean(),
});

export type ActionIntent = z.infer<typeof ActionIntentSchema>;
export type ConversationMessageRequest = z.infer<typeof ConversationMessageRequestSchema>;
export type ParsedActionEnvelope = z.infer<typeof ParsedActionEnvelopeSchema>;
export type ActionPlanStep = z.infer<typeof ActionPlanStepSchema>;
export type ActionPlanEnvelope = z.infer<typeof ActionPlanEnvelopeSchema>;
export type SubmitActionRequest = z.infer<typeof SubmitActionRequestSchema>;
export type ActionExecutionResponse = z.infer<typeof ActionExecutionResponseSchema>;
export type ActionTravelResult = z.infer<typeof ActionTravelResultSchema>;
export type ActionPlanStepExecution = z.infer<typeof ActionPlanStepExecutionSchema>;
export type ActionPlanExecutionResponse = z.infer<typeof ActionPlanExecutionResponseSchema>;
