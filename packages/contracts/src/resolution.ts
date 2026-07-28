import { z } from "zod";

export const OutcomeGradeSchema = z.enum([
  "complete_success",
  "success_with_consequence",
  "partial_success",
  "failure_with_progress",
  "failure",
  "catastrophic_reversal",
]);

export const ResolutionModifierSchema = z.object({
  factorId: z.string().min(1),
  value: z.number().int().min(-5).max(5),
  reason: z.string().min(1),
  sourceId: z.string().optional(),
});

export const CreateInformationAssetOperationSchema = z.object({
  type: z.literal("create_information_asset"),
  holderId: z.string().uuid(),
  subjectId: z.string().uuid().optional(),
  content: z.string().min(1),
  confidence: z.number().min(0).max(1),
  truthStatus: z.enum(["observation", "inference", "rumor"]).default("observation"),
});
export const ConsumeResourceOperationSchema = z.object({
  type: z.literal("consume_resource"),
  instanceId: z.string().uuid(),
  resource: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  amount: z.number().positive(),
});
export const SetInstanceStateOperationSchema = z.object({
  type: z.literal("set_instance_state"),
  instanceId: z.string().uuid(),
  path: z
    .array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/))
    .min(1)
    .max(4),
  value: z.unknown(),
});
export const ChangeInstanceConditionOperationSchema = z.object({
  type: z.literal("change_instance_condition"),
  instanceId: z.string().uuid(),
  delta: z.number().int().min(-100).max(100),
});
export const StateOperationSchema = z.discriminatedUnion("type", [
  CreateInformationAssetOperationSchema,
  ConsumeResourceOperationSchema,
  SetInstanceStateOperationSchema,
  ChangeInstanceConditionOperationSchema,
]);

export const ResolutionResultSchema = z.object({
  outcomeGrade: OutcomeGradeSchema,
  margin: z.number().int(),
  uncertainty: z.number().int(),
  modifiers: z.array(ResolutionModifierSchema),
  calculationTrace: z.array(z.string().min(1)),
  stateOperations: z.array(StateOperationSchema).default([]),
  narrativeConstraints: z.array(z.string()).default([]),
});

export type OutcomeGrade = z.infer<typeof OutcomeGradeSchema>;
export type ResolutionModifier = z.infer<typeof ResolutionModifierSchema>;
export type StateOperation = z.infer<typeof StateOperationSchema>;
export type ResolutionResult = z.infer<typeof ResolutionResultSchema>;
