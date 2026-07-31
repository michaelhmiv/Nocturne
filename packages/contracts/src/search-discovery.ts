import { z } from "zod";
import { OutcomeGradeSchema, ResolutionModifierSchema } from "./resolution.js";

const UuidSchema = z.string().uuid();
const TextSchema = z.string().trim().min(1).max(2_000);

export const SearchTargetFamilySchema = z.enum([
  "animal",
  "person",
  "item",
  "entrance",
  "evidence",
  "resource",
  "route",
  "hazard",
  "hidden_space",
  "information",
  "other",
]);
export type SearchTargetFamily = z.infer<typeof SearchTargetFamilySchema>;

export const SearchDiscoveryAnalysisRequestSchema = z
  .object({
    rawText: TextSchema,
    actorId: UuidSchema,
    areaId: UuidSchema,
    areaName: z.string().trim().min(1).max(240),
    areaDescription: TextSchema,
    requestedConcept: TextSchema,
    actorFacts: z.array(z.string().trim().min(1).max(500)).max(32),
    areaFacts: z.array(z.string().trim().min(1).max(500)).max(32),
    existingCandidates: z
      .array(
        z
          .object({
            entityId: UuidSchema,
            name: z.string().trim().min(1).max(240),
            conceptSummary: TextSchema,
            hidden: z.boolean(),
            concealment: z.number().int().min(0).max(100),
            supportingFactIds: z.array(z.string().trim().min(1).max(200)).max(24),
          })
          .strict(),
      )
      .max(32),
    materializationSourceIds: z.array(UuidSchema).max(32),
  })
  .strict();
export type SearchDiscoveryAnalysisRequest = z.infer<typeof SearchDiscoveryAnalysisRequestSchema>;

export const SearchDiscoveryAnalysisSchema = z
  .object({
    targetFamily: SearchTargetFamilySchema,
    requestedConcept: TextSchema,
    selectedExistingEntityId: UuidSchema.optional(),
    mayMaterialize: z.boolean(),
    selectedMaterializationSourceId: UuidSchema.optional(),
    actorScore: z.number().int().min(-100).max(100),
    targetScore: z.number().int().min(-100).max(100),
    modifiers: z.array(ResolutionModifierSchema).max(16),
    successDescription: TextSchema,
    consequenceDescription: TextSchema,
    partialDescription: TextSchema,
    progressDescription: TextSchema,
    failureDescription: TextSchema,
    reversalDescription: TextSchema,
    assumptions: z.array(z.string().trim().min(1).max(500)).max(16),
  })
  .strict()
  .superRefine((analysis, context) => {
    if (analysis.selectedExistingEntityId && analysis.mayMaterialize) {
      context.addIssue({
        code: "custom",
        path: ["mayMaterialize"],
        message: "Search must prefer an existing entity before materialization",
      });
    }
    if (analysis.mayMaterialize !== Boolean(analysis.selectedMaterializationSourceId)) {
      context.addIssue({
        code: "custom",
        path: ["selectedMaterializationSourceId"],
        message: "Materialization permission requires exactly one source",
      });
    }
  });
export type SearchDiscoveryAnalysis = z.infer<typeof SearchDiscoveryAnalysisSchema>;

export const SearchDiscoveryResultSchema = z
  .object({
    eventId: UuidSchema,
    outcomeGrade: OutcomeGradeSchema,
    discoveredEntityId: UuidSchema.optional(),
    materialized: z.boolean(),
    informationIds: z.array(UuidSchema).max(16),
    playerVisibleFacts: z.array(z.string().trim().min(1).max(500)).max(32),
    narrationConstraints: z.array(z.string().trim().min(1).max(500)).max(32),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.materialized && !result.discoveredEntityId) {
      context.addIssue({
        code: "custom",
        path: ["discoveredEntityId"],
        message: "Materialized searches require a discovered entity",
      });
    }
  });
export type SearchDiscoveryResult = z.infer<typeof SearchDiscoveryResultSchema>;
