import { z } from "zod";

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
  createdAt: z.string().datetime(),
  idempotentReplay: z.boolean(),
});

export type ActionIntent = z.infer<typeof ActionIntentSchema>;
export type ParsedActionEnvelope = z.infer<typeof ParsedActionEnvelopeSchema>;
export type SubmitActionRequest = z.infer<typeof SubmitActionRequestSchema>;
export type ActionExecutionResponse = z.infer<typeof ActionExecutionResponseSchema>;
