import { z } from "zod";

const UuidSchema = z.string().uuid();
const SlugSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const TextSchema = z.string().trim().min(1).max(2_000);
const JsonObjectSchema = z.record(z.string(), z.unknown());

export const MaterializationSourceCandidateSchema = z
  .object({
    sourceId: UuidSchema,
    sourceType: z.enum([
      "population_reservoir",
      "ecology_profile",
      "ambient_resource_pool",
      "property_contents_profile",
      "encounter_source",
      "prior_event",
      "scheduled_arrival",
      "explicit_creation",
    ]),
    locationId: UuidSchema,
    name: z.string().trim().min(1).max(200),
    description: TextSchema,
    semanticScope: JsonObjectSchema,
    constraints: z.array(z.string().trim().min(1).max(500)).max(32),
    capacity: z.number().nonnegative(),
    rarityPolicy: JsonObjectSchema,
    metadata: JsonObjectSchema.default({}),
  })
  .strict();
export type MaterializationSourceCandidate = z.infer<typeof MaterializationSourceCandidateSchema>;

export const ReusableDefinitionCandidateSchema = z
  .object({
    definitionId: z.string().trim().min(1).max(160),
    definitionType: SlugSchema,
    name: z.string().trim().min(1).max(200),
    conceptSummary: TextSchema,
    currentPayload: JsonObjectSchema.default({}),
  })
  .strict();

export const MaterializationAnalysisRequestSchema = z
  .object({
    requestedConcept: TextSchema,
    locationId: UuidSchema,
    locationName: z.string().trim().min(1).max(200),
    locationDescription: TextSchema,
    worldContext: JsonObjectSchema.default({}),
    sourceCandidates: z.array(MaterializationSourceCandidateSchema).max(32),
    reusableDefinitions: z.array(ReusableDefinitionCandidateSchema).max(32),
  })
  .strict();
export type MaterializationAnalysisRequest = z.infer<typeof MaterializationAnalysisRequestSchema>;

export const MaterializationProposalSchema = z
  .object({
    decision: z.enum(["materialize", "reject"]),
    selectedSourceId: UuidSchema.optional(),
    rejectionReason: z.string().trim().min(1).max(1_000).optional(),
    definition: z
      .object({
        reuseDefinitionId: z.string().trim().min(1).max(160).optional(),
        definitionType: SlugSchema,
        name: z.string().trim().min(1).max(200),
        conceptSummary: TextSchema,
        revisionPayload: JsonObjectSchema,
      })
      .strict()
      .optional(),
    instance: z
      .object({
        displayName: z.string().trim().min(1).max(200),
        distinguishingTraits: z.array(z.string().trim().min(1).max(200)).max(20),
        condition: z.number().int().min(1).max(100),
        state: JsonObjectSchema,
      })
      .strict()
      .optional(),
    semanticFingerprintBasis: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
    narrationFacts: z.array(z.string().trim().min(1).max(500)).max(12),
    assumptions: z.array(z.string().trim().min(1).max(500)).max(12),
  })
  .strict()
  .superRefine((proposal, context) => {
    if (proposal.decision === "materialize") {
      if (!proposal.selectedSourceId) {
        context.addIssue({
          code: "custom",
          path: ["selectedSourceId"],
          message: "Materialization requires a selected authoritative source",
        });
      }
      if (!proposal.definition) {
        context.addIssue({
          code: "custom",
          path: ["definition"],
          message: "Materialization requires definition semantics",
        });
      }
      if (!proposal.instance) {
        context.addIssue({
          code: "custom",
          path: ["instance"],
          message: "Materialization requires unique instance semantics",
        });
      }
      if (proposal.rejectionReason) {
        context.addIssue({
          code: "custom",
          path: ["rejectionReason"],
          message: "Successful materialization cannot include a rejection reason",
        });
      }
    } else {
      if (!proposal.rejectionReason) {
        context.addIssue({
          code: "custom",
          path: ["rejectionReason"],
          message: "Rejected materialization requires a reason",
        });
      }
      if (proposal.selectedSourceId || proposal.definition || proposal.instance) {
        context.addIssue({
          code: "custom",
          path: ["decision"],
          message: "Rejected materialization cannot create authoritative content",
        });
      }
    }
  });
export type MaterializationProposal = z.infer<typeof MaterializationProposalSchema>;

export const MaterializationResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("existing"),
      requestId: UuidSchema,
      entityId: UuidSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("materialized"),
      requestId: UuidSchema,
      entityId: UuidSchema,
      eventId: UuidSchema,
      sourceId: UuidSchema,
      semanticFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("rejected"),
      requestId: UuidSchema,
      reason: TextSchema,
    })
    .strict(),
]);
export type MaterializationResult = z.infer<typeof MaterializationResultSchema>;
