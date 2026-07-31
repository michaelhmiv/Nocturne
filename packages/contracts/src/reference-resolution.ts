import { z } from "zod";

const UuidSchema = z.string().uuid();
const TextSchema = z.string().trim().min(1).max(2_000);

export const EntityMentionKindSchema = z.enum([
  "proper_name",
  "alias",
  "description",
  "pronoun",
  "relationship",
  "location",
  "ordinal",
  "possessive",
  "unknown",
]);
export type EntityMentionKind = z.infer<typeof EntityMentionKindSchema>;

export const EntityReferenceStatusSchema = z.enum([
  "resolved",
  "ambiguous",
  "not_found",
  "known_but_inaccessible",
  "known_but_location_unknown",
  "stale_reference",
]);
export type EntityReferenceStatus = z.infer<typeof EntityReferenceStatusSchema>;

export const EntityReferenceCandidateSchema = z
  .object({
    entityId: UuidSchema,
    displayName: z.string().trim().min(1).max(240),
    definitionType: z.string().trim().min(1).max(100),
    lifecycleStatus: z.string().trim().min(1).max(80),
    locationId: UuidSchema.nullable(),
    aliases: z.array(z.string().trim().min(1).max(240)).max(20),
    relationshipLabels: z.array(z.string().trim().min(1).max(120)).max(20),
    relevanceScore: z.number().int().min(-100_000).max(100_000),
    accessible: z.boolean(),
    present: z.boolean(),
    supportingFactIds: z.array(z.string().trim().min(1).max(200)).max(32),
  })
  .strict();
export type EntityReferenceCandidate = z.infer<typeof EntityReferenceCandidateSchema>;

export const EntityReferenceInterpretationRequestSchema = z
  .object({
    command: TextSchema,
    viewpointId: UuidSchema,
    recentPlayerSafeText: z.array(z.string().trim().min(1).max(2_000)).max(20),
    candidates: z.array(EntityReferenceCandidateSchema).max(96),
  })
  .strict();
export type EntityReferenceInterpretationRequest = z.infer<
  typeof EntityReferenceInterpretationRequestSchema
>;

export const EntityMentionResolutionSchema = z
  .object({
    order: z.number().int().positive().max(32),
    mentionText: z.string().trim().min(1).max(300),
    mentionKind: EntityMentionKindSchema,
    status: EntityReferenceStatusSchema,
    selectedEntityId: UuidSchema.optional(),
    candidateEntityIds: z.array(UuidSchema).max(12),
    confidenceBasisPoints: z.number().int().min(0).max(10_000),
    supportingFactIds: z.array(z.string().trim().min(1).max(200)).max(32),
    requiresClarification: z.boolean(),
    clarificationPrompt: z.string().trim().min(1).max(500).optional(),
    rationale: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((resolution, context) => {
    if ((resolution.status === "resolved") !== Boolean(resolution.selectedEntityId)) {
      context.addIssue({
        code: "custom",
        path: ["selectedEntityId"],
        message: "Only resolved references may select exactly one entity",
      });
    }
    if (
      resolution.selectedEntityId &&
      !resolution.candidateEntityIds.includes(resolution.selectedEntityId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidateEntityIds"],
        message: "Selected entity must be one of the supplied candidates",
      });
    }
    if (resolution.requiresClarification && !resolution.clarificationPrompt) {
      context.addIssue({
        code: "custom",
        path: ["clarificationPrompt"],
        message: "Clarification-required references need a prompt",
      });
    }
  });
export type EntityMentionResolution = z.infer<typeof EntityMentionResolutionSchema>;

export const EntityReferenceInterpretationSchema = z
  .object({
    mentions: z.array(EntityMentionResolutionSchema).max(32),
  })
  .strict()
  .superRefine(({ mentions }, context) => {
    mentions.forEach((mention, index) => {
      if (mention.order !== index + 1) {
        context.addIssue({
          code: "custom",
          path: ["mentions", index, "order"],
          message: "Mention order must be consecutive from one",
        });
      }
    });
  });
export type EntityReferenceInterpretation = z.infer<typeof EntityReferenceInterpretationSchema>;
