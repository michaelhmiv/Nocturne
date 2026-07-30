import { z } from "zod";
import { GeneratedDefinitionDraftSchema } from "./content.js";

export const NormalizeContentRequestSchema = z.object({
  characterId: z.string().uuid(),
  residenceId: z.string().uuid().optional(),
  rawConcept: z.string().trim().min(1).max(8_000),
  intendedUse: z.string().trim().min(1).max(1_000).optional(),
});

export const NormalizedContentEnvelopeSchema = z.object({
  draft: GeneratedDefinitionDraftSchema,
  rationale: z.array(z.string().min(1)).default([]),
  assumptions: z.array(z.string().min(1)).default([]),
  provisionalComponents: z.array(z.string().min(1)).default([]),
});

export const InstallInventionInputSchema = z.object({
  characterId: z.string().uuid(),
  residenceId: z.string().uuid(),
});

export const InstallationIssueSchema = z.object({
  capacity: z.string().min(1),
  required: z.number().nonnegative(),
  available: z.number().nonnegative(),
  message: z.string().min(1),
});

export const InstallationEvaluationSchema = z.object({
  fits: z.boolean(),
  required: z.record(z.string(), z.number().nonnegative()),
  available: z.record(z.string(), z.number().nonnegative()),
  issues: z.array(InstallationIssueSchema),
  warnings: z.array(z.string()),
});

export const InventionSummarySchema = z.object({
  requestId: z.string().uuid(),
  characterId: z.string().uuid(),
  rawConcept: z.string(),
  status: z.string(),
  definitionId: z.string().nullable(),
  installedInstanceId: z.string().uuid().nullable(),
  draft: GeneratedDefinitionDraftSchema.nullable(),
  validation: z.record(z.string(), z.unknown()).nullable(),
  installation: InstallationEvaluationSchema.nullable(),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export type NormalizeContentRequest = z.infer<typeof NormalizeContentRequestSchema>;
export type NormalizedContentEnvelope = z.infer<typeof NormalizedContentEnvelopeSchema>;
export type InstallInventionInput = z.infer<typeof InstallInventionInputSchema>;
export type InstallationEvaluation = z.infer<typeof InstallationEvaluationSchema>;
export type InventionSummary = z.infer<typeof InventionSummarySchema>;
