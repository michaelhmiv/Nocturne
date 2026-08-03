import { z } from "zod";
import { WorldActionKindSchema } from "./world-action.js";

const UuidSchema = z.string().uuid();
const SlugSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const TextSchema = z.string().trim().min(1).max(4_000);
const ReferenceTextSchema = z.string().trim().min(1).max(500);
const DemandSchema = z.number().int().min(0).max(10);

export const SemanticReferenceRoleSchema = z.enum([
  "target",
  "object",
  "tool",
  "anatomy",
  "location",
  "business",
  "listing",
  "resource",
]);
export type SemanticReferenceRole = z.infer<typeof SemanticReferenceRoleSchema>;

export const SemanticReferenceRelationshipSchema = z.enum([
  "none",
  "visible",
  "nearby",
  "possessed",
  "owned",
  "controlled",
  "current_location",
  "available",
  "intrinsic",
]);
export type SemanticReferenceRelationship = z.infer<
  typeof SemanticReferenceRelationshipSchema
>;

export const SemanticReferenceResolutionSchema = z.enum([
  "resolved_entity",
  "resolved_intrinsic",
  "unresolved",
  "ambiguous",
]);
export type SemanticReferenceResolution = z.infer<typeof SemanticReferenceResolutionSchema>;

export const SemanticEntityReferenceSchema = z
  .object({
    referenceKey: SlugSchema,
    originalText: ReferenceTextSchema,
    normalizedText: ReferenceTextSchema,
    role: SemanticReferenceRoleSchema,
    required: z.boolean(),
    relationship: SemanticReferenceRelationshipSchema,
    resolution: SemanticReferenceResolutionSchema,
    resolvedEntityId: UuidSchema.optional(),
    candidateEntityIds: z.array(UuidSchema).max(32).default([]),
    allowClarification: z.boolean().default(true),
  })
  .strict()
  .superRefine((reference, context) => {
    if (reference.resolution === "resolved_entity" && !reference.resolvedEntityId) {
      context.addIssue({
        code: "custom",
        path: ["resolvedEntityId"],
        message: "Entity-resolved references require a resolved entity ID.",
      });
    }
    if (reference.resolution !== "resolved_entity" && reference.resolvedEntityId) {
      context.addIssue({
        code: "custom",
        path: ["resolvedEntityId"],
        message: "Only entity-resolved references may include a resolved entity ID.",
      });
    }
    if (reference.resolution === "ambiguous" && reference.candidateEntityIds.length < 2) {
      context.addIssue({
        code: "custom",
        path: ["candidateEntityIds"],
        message: "Ambiguous references require at least two candidates.",
      });
    }
    if (
      reference.resolution === "resolved_intrinsic" &&
      reference.relationship !== "intrinsic"
    ) {
      context.addIssue({
        code: "custom",
        path: ["relationship"],
        message: "Intrinsic references require the intrinsic relationship.",
      });
    }
  });
export type SemanticEntityReference = z.infer<typeof SemanticEntityReferenceSchema>;

export const SemanticClaimTypeSchema = z.enum([
  "possession",
  "ownership",
  "anatomy",
  "duration",
  "resource",
  "location",
  "capability",
]);
export type SemanticClaimType = z.infer<typeof SemanticClaimTypeSchema>;

export const SemanticActionClaimSchema = z
  .object({
    claimKey: SlugSchema,
    claimType: SemanticClaimTypeSchema,
    sourceText: ReferenceTextSchema,
    normalizedValue: ReferenceTextSchema,
    required: z.boolean(),
    referenceKey: SlugSchema.optional(),
    quantity: z.number().positive().max(1_000_000).optional(),
    durationSeconds: z.number().int().positive().max(31_536_000).optional(),
  })
  .strict()
  .superRefine((claim, context) => {
    if (claim.claimType === "duration" && claim.durationSeconds === undefined) {
      context.addIssue({
        code: "custom",
        path: ["durationSeconds"],
        message: "Duration claims require durationSeconds.",
      });
    }
    if (claim.claimType !== "duration" && claim.durationSeconds !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["durationSeconds"],
        message: "Only duration claims may include durationSeconds.",
      });
    }
  });
export type SemanticActionClaim = z.infer<typeof SemanticActionClaimSchema>;

export const SemanticActionPropertiesSchema = z
  .object({
    selfDirected: z.boolean(),
    opposed: z.boolean(),
    destructive: z.boolean(),
    illegal: z.boolean(),
    social: z.boolean(),
    movement: z.boolean(),
    continuous: z.boolean(),
  })
  .strict();

export const SemanticActionDemandsSchema = z
  .object({
    physicalEffort: DemandSchema,
    technicalComplexity: DemandSchema,
    precision: DemandSchema,
    danger: DemandSchema,
    timePressure: DemandSchema,
  })
  .strict();

export const SemanticActionFrameSchema = z
  .object({
    kind: WorldActionKindSchema,
    actionType: SlugSchema,
    objective: TextSchema,
    actorId: UuidSchema,
    targetIds: z.array(UuidSchema).max(32),
    objectIds: z.array(UuidSchema).max(32),
    toolIds: z.array(UuidSchema).max(32),
    locationId: UuidSchema.optional(),
    quantity: z.number().positive().max(1_000_000).optional(),
    durationSeconds: z.number().int().positive().max(31_536_000).optional(),
    references: z.array(SemanticEntityReferenceSchema).max(64).default([]),
    claims: z.array(SemanticActionClaimSchema).max(64).default([]),
    properties: SemanticActionPropertiesSchema,
    demands: SemanticActionDemandsSchema,
    assumptions: z.array(z.string().trim().min(1).max(500)).max(32),
    ambiguities: z.array(z.string().trim().min(1).max(500)).max(16),
  })
  .strict()
  .superRefine((frame, context) => {
    if (frame.properties.selfDirected && frame.targetIds.some((id) => id !== frame.actorId)) {
      context.addIssue({
        code: "custom",
        path: ["properties", "selfDirected"],
        message: "Self-directed actions cannot target another entity",
      });
    }

    const referenceKeys = new Set<string>();
    for (const reference of frame.references) {
      if (referenceKeys.has(reference.referenceKey)) {
        context.addIssue({
          code: "custom",
          path: ["references"],
          message: `Duplicate semantic reference key ${reference.referenceKey}.`,
        });
      }
      referenceKeys.add(reference.referenceKey);
    }

    const claimKeys = new Set<string>();
    for (const claim of frame.claims) {
      if (claimKeys.has(claim.claimKey)) {
        context.addIssue({
          code: "custom",
          path: ["claims"],
          message: `Duplicate semantic claim key ${claim.claimKey}.`,
        });
      }
      claimKeys.add(claim.claimKey);
      if (claim.referenceKey && !referenceKeys.has(claim.referenceKey)) {
        context.addIssue({
          code: "custom",
          path: ["claims"],
          message: `Claim ${claim.claimKey} refers to missing reference ${claim.referenceKey}.`,
        });
      }
    }
  });
export type SemanticActionFrame = z.infer<typeof SemanticActionFrameSchema>;

export const ActionResolutionModeSchema = z.enum([
  "automatic_success",
  "automatic_failure",
  "clarification_required",
  "unopposed_check",
  "opposed_contest",
  "timed_task",
  "transaction",
  "movement",
  "conversation",
  "composite_plan",
]);
export type ActionResolutionMode = z.infer<typeof ActionResolutionModeSchema>;

export const ActionResolutionDecisionSchema = z
  .object({
    mode: ActionResolutionModeSchema,
    rationale: z.string().trim().min(1).max(1_500),
    meaningfulUncertainty: z.boolean(),
    difficulty: DemandSchema,
    opposition: DemandSchema,
    consequenceLevel: DemandSchema,
    requiredFactIds: z.array(z.string().trim().min(1).max(200)).max(32),
  })
  .strict()
  .superRefine((decision, context) => {
    if (
      [
        "automatic_success",
        "automatic_failure",
        "movement",
        "conversation",
        "transaction",
      ].includes(decision.mode) &&
      decision.meaningfulUncertainty
    ) {
      context.addIssue({
        code: "custom",
        path: ["meaningfulUncertainty"],
        message: "Deterministic resolution modes cannot claim meaningful uncertainty",
      });
    }
    if (
      ["unopposed_check", "opposed_contest"].includes(decision.mode) &&
      !decision.meaningfulUncertainty
    ) {
      context.addIssue({
        code: "custom",
        path: ["meaningfulUncertainty"],
        message: "Checks and contests require meaningful uncertainty",
      });
    }
  });
export type ActionResolutionDecision = z.infer<typeof ActionResolutionDecisionSchema>;

export const SemanticActionStepPayloadSchema = z
  .object({
    rawText: TextSchema,
    actionFrame: SemanticActionFrameSchema,
    resolution: ActionResolutionDecisionSchema.optional(),
  })
  .passthrough();
export type SemanticActionStepPayload = z.infer<typeof SemanticActionStepPayloadSchema>;
