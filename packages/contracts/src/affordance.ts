import { z } from "zod";
import { GameMasterContextSchema } from "./game-master-context.js";
import { WorldActionKindSchema } from "./world-action.js";

const UuidSchema = z.string().uuid();
const TextSchema = z.string().trim().min(1).max(4_000);

export const AffordancePremiseRoleSchema = z.enum([
  "subject",
  "object",
  "source",
  "method",
  "location",
  "incidental",
]);
export type AffordancePremiseRole = z.infer<typeof AffordancePremiseRoleSchema>;

export const AffordancePersistenceStatusSchema = z.enum([
  "established",
  "plausible_ephemeral",
  "scene_local",
  "persistent_required",
  "contradictory",
  "uncertain",
]);
export type AffordancePersistenceStatus = z.infer<typeof AffordancePersistenceStatusSchema>;

export const AffordanceAdvantageCategorySchema = z.enum([
  "none",
  "currency",
  "weapon",
  "ammunition",
  "credential",
  "key",
  "vehicle",
  "named_person",
  "rare_medicine",
  "major_resource",
  "security_access",
  "high_value_item",
]);
export type AffordanceAdvantageCategory = z.infer<typeof AffordanceAdvantageCategorySchema>;

export const AffordancePremiseSchema = z
  .object({
    text: TextSchema,
    concept: z.string().trim().min(1).max(500),
    role: AffordancePremiseRoleSchema,
    status: AffordancePersistenceStatusSchema,
    persistenceReason: z.string().trim().min(1).max(1_000),
    advantageCategories: z.array(AffordanceAdvantageCategorySchema).min(1).max(12),
    potentialConsequences: z.array(z.string().trim().min(1).max(500)).max(16),
  })
  .strict();
export type AffordancePremise = z.infer<typeof AffordancePremiseSchema>;

export const AffordanceAssessmentRequestSchema = z
  .object({
    command: TextSchema,
    actorId: UuidSchema,
    resolvedEntityIds: z.array(UuidSchema).max(32),
    gameMasterContext: GameMasterContextSchema,
    enabledHandlers: z.array(WorldActionKindSchema).min(1),
  })
  .strict();
export type AffordanceAssessmentRequest = z.infer<typeof AffordanceAssessmentRequestSchema>;

export const AffordanceAssessmentSchema = z
  .object({
    terminalIntent: WorldActionKindSchema,
    premises: z.array(AffordancePremiseSchema).max(32),
    requiresSearch: z.boolean(),
    requiresClarification: z.boolean(),
    clarificationPrompt: z.string().trim().min(1).max(500).optional(),
    rationale: z.string().trim().min(1).max(1_500),
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
    const unsafeImprovisation = assessment.premises.find(
      (premise) =>
        ["plausible_ephemeral", "scene_local"].includes(premise.status) &&
        premise.advantageCategories.some((category) => category !== "none"),
    );
    if (unsafeImprovisation) {
      context.addIssue({
        code: "custom",
        path: ["premises"],
        message: "Advantage-bearing premises cannot be authorized as ephemeral or scene-local",
      });
    }
  });
export type AffordanceAssessment = z.infer<typeof AffordanceAssessmentSchema>;
