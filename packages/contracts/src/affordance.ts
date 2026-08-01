import { z } from "zod";
import { WorldActionKindSchema } from "./world-action.js";

const TextSchema = z.string().trim().min(1).max(1_000);

export const AffordancePremiseStatusSchema = z.enum([
  "established",
  "plausible_ephemeral",
  "scene_local",
  "persistent_required",
  "contradictory",
  "uncertain",
]);
export type AffordancePremiseStatus = z.infer<typeof AffordancePremiseStatusSchema>;

export const AffordancePremiseRoleSchema = z.enum([
  "subject",
  "object",
  "source",
  "method",
  "location",
  "incidental",
]);

export const AffordancePremiseSchema = z
  .object({
    text: TextSchema,
    concept: z.string().trim().min(1).max(240),
    role: AffordancePremiseRoleSchema,
    status: AffordancePremiseStatusSchema,
    persistenceReason: TextSchema,
    potentialAdvantages: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
    potentialConsequences: z.array(z.string().trim().min(1).max(240)).max(8).default([]),
  })
  .strict();

export const AffordanceAssessmentRequestSchema = z
  .object({
    command: z.string().trim().min(1).max(4_000),
    actorId: z.string().uuid(),
    currentScene: z
      .object({
        locationId: z.string().uuid().nullable(),
        name: z.string().trim().min(1).max(240),
        description: z.string().max(2_000),
      })
      .strict(),
    recentTurns: z.array(z.string().trim().min(1).max(4_000)).max(20).default([]),
    playerKnownFacts: z.array(z.record(z.string(), z.unknown())).max(192),
    enabledHandlers: z.array(WorldActionKindSchema).min(1),
  })
  .strict();
export type AffordanceAssessmentRequest = z.infer<typeof AffordanceAssessmentRequestSchema>;

export const AffordanceAssessmentSchema = z
  .object({
    terminalIntent: WorldActionKindSchema,
    premises: z.array(AffordancePremiseSchema).max(24).default([]),
    requiresSearch: z.boolean(),
    requiresClarification: z.boolean(),
    clarificationPrompt: z.string().trim().min(1).max(500).optional(),
    rationale: TextSchema,
  })
  .strict()
  .superRefine((assessment, context) => {
    if (assessment.requiresClarification !== Boolean(assessment.clarificationPrompt)) {
      context.addIssue({
        code: "custom",
        path: ["clarificationPrompt"],
        message: "Clarification state and prompt must agree",
      });
    }
    if (assessment.requiresSearch && assessment.terminalIntent !== "search") {
      const assertedEphemeral = assessment.premises.some(
        (premise) => premise.status === "plausible_ephemeral",
      );
      if (assertedEphemeral) {
        context.addIssue({
          code: "custom",
          path: ["requiresSearch"],
          message: "A harmless asserted ephemeral premise cannot force a supporting search",
        });
      }
    }
  });
export type AffordanceAssessment = z.infer<typeof AffordanceAssessmentSchema>;

export const EphemeralConsumptionAnalysisRequestSchema = z
  .object({
    actorId: z.string().uuid(),
    rawText: z.string().trim().min(1).max(4_000),
    locationName: z.string().trim().min(1).max(240),
    locationDescription: z.string().max(2_000),
    concept: z.string().trim().min(1).max(240),
    sourceDescription: z.string().trim().min(1).max(500),
    recentTurns: z.array(z.string().trim().min(1).max(4_000)).max(10).default([]),
  })
  .strict();

const EphemeralDeltaSchema = z
  .object({
    resource: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
    delta: z.number().int().min(-10).max(10),
    rationale: z.string().trim().min(1).max(500),
  })
  .strict();

const EphemeralConditionSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    key: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
    intensity: z.number().int().min(-5).max(5),
    durationSeconds: z.number().int().positive().max(86_400),
    rationale: z.string().trim().min(1).max(500),
  })
  .strict();

export const EphemeralConsumptionAnalysisSchema = z
  .object({
    displayName: z.string().trim().min(1).max(180),
    substanceKind: z.string().trim().min(1).max(100),
    portionDescription: z.string().trim().min(1).max(300),
    plausibility: z.enum(["ordinary", "unusual_but_plausible", "implausible"]),
    consumable: z.boolean(),
    nutritionValue: z.enum(["none", "negligible", "minor"]),
    hydrationValue: z.enum(["none", "negligible", "minor"]),
    resourceDeltas: z.array(EphemeralDeltaSchema).max(6).default([]),
    conditions: z.array(EphemeralConditionSchema).max(4).default([]),
    contaminationRiskBasisPoints: z.number().int().min(0).max(5_000),
    contaminationEffects: z.array(EphemeralDeltaSchema).max(4).default([]),
    narrationFacts: z.array(z.string().trim().min(1).max(500)).max(12).default([]),
    rationale: TextSchema,
  })
  .strict()
  .superRefine((analysis, context) => {
    if (analysis.plausibility === "implausible" && analysis.consumable) {
      context.addIssue({
        code: "custom",
        path: ["consumable"],
        message: "An implausible ephemeral premise cannot be consumed",
      });
    }
    if (analysis.nutritionValue === "none") {
      for (const delta of analysis.resourceDeltas) {
        if (delta.resource === "satiety" && delta.delta > 0) {
          context.addIssue({
            code: "custom",
            path: ["resourceDeltas"],
            message: "No-nutrition substances cannot increase satiety",
          });
        }
      }
    }
  });
export type EphemeralConsumptionAnalysis = z.infer<typeof EphemeralConsumptionAnalysisSchema>;
