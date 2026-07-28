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

export const ResolutionResultSchema = z.object({
  outcomeGrade: OutcomeGradeSchema,
  margin: z.number().int(),
  uncertainty: z.number().int(),
  modifiers: z.array(ResolutionModifierSchema),
  calculationTrace: z.array(z.string().min(1)),
  stateOperations: z.array(z.record(z.string(), z.unknown())).default([]),
  narrativeConstraints: z.array(z.string()).default([]),
});

export type OutcomeGrade = z.infer<typeof OutcomeGradeSchema>;
export type ResolutionModifier = z.infer<typeof ResolutionModifierSchema>;
export type ResolutionResult = z.infer<typeof ResolutionResultSchema>;
