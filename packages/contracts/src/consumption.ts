import { z } from "zod";
import type { OutcomeGrade } from "./resolution.js";

const SemanticKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/);

export const ConsumptionCandidateSchema = z.object({
  sourceType: z.enum(["entity", "ambient_pool"]),
  sourceId: z.string().uuid(),
  name: z.string().min(1).max(180),
  description: z.string().min(1).max(2_000),
  access: z.enum(["owned", "carried", "visible", "ambient"]),
  quantity: z.number().positive().max(1_000).optional(),
  state: z.record(z.string(), z.unknown()).default({}),
  constraints: z.array(z.string().min(1).max(500)).max(12).default([]),
});

export const ConsumptionAnalysisRequestSchema = z.object({
  actorId: z.string().uuid(),
  rawText: z.string().trim().min(3).max(4_000),
  locationName: z.string().min(1).max(180),
  locationDescription: z.string().max(2_000).default(""),
  actorState: z.record(z.string(), z.unknown()).default({}),
  candidates: z.array(ConsumptionCandidateSchema).max(32),
});

export const ConsumptionResourceDeltaSchema = z.object({
  resource: SemanticKeySchema,
  delta: z.number().int().min(-25).max(25),
  rationale: z.string().min(1).max(500),
});

export const ConsumptionConditionEffectSchema = z.object({
  name: z.string().trim().min(1).max(100),
  key: SemanticKeySchema,
  intensity: z.number().int().min(-10).max(10),
  durationSeconds: z.number().int().positive().max(604_800),
  rationale: z.string().min(1).max(500),
});

export const ConsumptionRiskSchema = z.object({
  description: z.string().min(1).max(500),
  chanceBasisPoints: z.number().int().min(0).max(10_000),
  resourceDeltas: z.array(ConsumptionResourceDeltaSchema).max(4).default([]),
  conditions: z.array(ConsumptionConditionEffectSchema).max(4).default([]),
});

export const ConsumptionSelectionSchema = z
  .object({
    sourceType: z.enum(["entity", "ambient_pool", "none"]),
    sourceId: z.string().uuid().optional(),
    displayName: z.string().min(1).max(180),
    rationale: z.string().min(1).max(1_000),
    confidence: z.number().min(0).max(1),
  })
  .superRefine((selection, context) => {
    if (selection.sourceType === "none" && selection.sourceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceId"],
        message: "A missing source cannot have an identifier.",
      });
    }
    if (selection.sourceType !== "none" && !selection.sourceId) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceId"],
        message: "A selected source requires an identifier.",
      });
    }
  });

export const ConsumptionMaterializationSchema = z.object({
  name: z.string().trim().min(1).max(180),
  conceptSummary: z.string().trim().min(1).max(1_000),
  descriptiveTraits: z.array(z.string().trim().min(1).max(100)).max(12).default([]),
  unitsCreated: z.number().int().min(0).max(5),
});

export const ConsumptionQuantityResolutionSchema = z.object({
  requestedUnits: z.number().int().min(1).max(100),
  availableUnits: z.number().int().nonnegative().max(1_000),
  appliedUnits: z.number().int().nonnegative().max(5),
  limitedByAvailability: z.boolean(),
  limitedByEngine: z.boolean(),
});

export const ConsumableAnalysisSchema = z
  .object({
    selection: ConsumptionSelectionSchema,
    classification: z.object({
      consumable: z.boolean(),
      substanceKind: z.string().trim().min(1).max(100),
      portionDescription: z.string().trim().min(1).max(300),
      freshnessAssessment: z.string().trim().min(1).max(500),
      confidence: z.number().min(0).max(1),
    }),
    requestedUnits: z.number().int().min(1).max(100).optional(),
    consumeUnits: z.number().int().nonnegative().max(5),
    quantityResolution: ConsumptionQuantityResolutionSchema.optional(),
    materialization: ConsumptionMaterializationSchema.optional(),
    resourceDeltas: z.array(ConsumptionResourceDeltaSchema).max(8).default([]),
    conditions: z.array(ConsumptionConditionEffectSchema).max(6).default([]),
    risks: z.array(ConsumptionRiskSchema).max(6).default([]),
    narrationFacts: z.array(z.string().min(1).max(500)).max(12).default([]),
    assumptions: z.array(z.string().min(1).max(500)).max(8).default([]),
  })
  .superRefine((analysis, context) => {
    const requiresMaterialization =
      analysis.selection.sourceType === "ambient_pool" &&
      analysis.classification.consumable &&
      analysis.consumeUnits > 0;

    if (requiresMaterialization && !analysis.materialization) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materialization"],
        message: "Consumed ambient resources must be materialized into a concrete substance.",
      });
    }
    if (requiresMaterialization && analysis.materialization?.unitsCreated === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materialization", "unitsCreated"],
        message: "Consumed ambient resources require a positive materialization quantity.",
      });
    }
    if (analysis.selection.sourceType !== "ambient_pool" && analysis.materialization) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["materialization"],
        message: "Only ambient resources may be materialized.",
      });
    }
  });

export const ConsumptionAppliedRiskSchema = z.object({
  description: z.string(),
  occurred: z.boolean(),
});

export const ConsumptionResultSchema = z.object({
  sourceType: z.enum(["entity", "ambient_pool"]),
  sourceId: z.string().uuid(),
  displayName: z.string(),
  unitsConsumed: z.number().int().nonnegative(),
  remainingUnits: z.number().nonnegative().nullable(),
  materialized: z.boolean(),
  resourceDeltas: z.array(ConsumptionResourceDeltaSchema),
  conditions: z.array(ConsumptionConditionEffectSchema),
  risks: z.array(ConsumptionAppliedRiskSchema),
});

export type ConsumptionCandidate = z.infer<typeof ConsumptionCandidateSchema>;
export type ConsumptionAnalysisRequest = z.infer<typeof ConsumptionAnalysisRequestSchema>;
export type ConsumptionResourceDelta = z.infer<typeof ConsumptionResourceDeltaSchema>;
export type ConsumptionConditionEffect = z.infer<typeof ConsumptionConditionEffectSchema>;
export type ConsumableAnalysis = z.infer<typeof ConsumableAnalysisSchema>;
export type ConsumptionResult = z.infer<typeof ConsumptionResultSchema>;
export type ConsumptionAppliedRisk = z.infer<typeof ConsumptionAppliedRiskSchema>;

export interface ConsumptionMechanicsResult {
  outcomeGrade: OutcomeGrade;
  resourceDeltas: ConsumptionResourceDelta[];
  conditions: ConsumptionConditionEffect[];
  risks: ConsumptionAppliedRisk[];
  calculationTrace: string[];
}
