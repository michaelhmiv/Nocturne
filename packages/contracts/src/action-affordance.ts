import { z } from "zod";

export const ActionAffordanceStatusSchema = z.enum([
  "feasible",
  "blocked",
  "clarification_required",
]);
export type ActionAffordanceStatus = z.infer<typeof ActionAffordanceStatusSchema>;

/** Backend-authoritative feasibility result evaluated before difficulty and randomness. */
export const ActionAffordanceEvaluationSchema = z
  .object({
    status: ActionAffordanceStatusSchema,
    rationale: z.string().trim().min(1).max(1_500),
    relevantFactIds: z.array(z.string().trim().min(1).max(200)).max(32),
    missingRequirements: z.array(z.string().trim().min(1).max(500)).max(16),
    warnings: z.array(z.string().trim().min(1).max(500)).max(16),
  })
  .strict()
  .superRefine((evaluation, context) => {
    if (evaluation.status === "feasible" && evaluation.missingRequirements.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["missingRequirements"],
        message: "Feasible actions cannot have missing requirements",
      });
    }
    if (evaluation.status !== "feasible" && evaluation.rationale.length < 10) {
      context.addIssue({
        code: "custom",
        path: ["rationale"],
        message: "Blocked or ambiguous actions require an explicit rationale",
      });
    }
  });
export type ActionAffordanceEvaluation = z.infer<typeof ActionAffordanceEvaluationSchema>;
