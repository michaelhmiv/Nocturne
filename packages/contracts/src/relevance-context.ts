import { z } from "zod";

const UuidSchema = z.string().uuid();
const TextSchema = z.string().trim().min(1).max(4_000);
const ContextValueSchema = z.union([
  z.string().max(4_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.unknown()).max(100),
  z.record(z.string(), z.unknown()),
]);

export const ContextInclusionReasonSchema = z.enum([
  "actor",
  "explicit_reference",
  "same_location",
  "location_ancestor",
  "owned",
  "controlled",
  "possessed",
  "contained",
  "accompanying",
  "relationship",
  "recent_event",
  "recent_reference",
  "active_plan",
  "scheduled_work",
  "materialization_source",
  "held_information",
  "safety_critical",
]);
export type ContextInclusionReason = z.infer<typeof ContextInclusionReasonSchema>;

export const RelevanceContextFactSchema = z
  .object({
    factId: z.string().trim().min(1).max(200),
    entityId: UuidSchema.optional(),
    claim: z.string().trim().min(1).max(240),
    value: ContextValueSchema,
    visibility: z.enum(["player_known", "authoritative_hidden"]),
    provenance: z
      .object({
        kind: z.enum([
          "world_state",
          "character_state",
          "prior_event",
          "content_definition",
          "held_information",
          "materialization_source",
          "plan_state",
          "scheduled_work",
        ]),
        sourceId: z.string().trim().min(1).max(200),
      })
      .strict(),
    relevanceScore: z.number().int().min(-100_000).max(100_000),
    inclusionReasons: z.array(ContextInclusionReasonSchema).min(1).max(16),
  })
  .strict();
export type RelevanceContextFact = z.infer<typeof RelevanceContextFactSchema>;

export const ContextEntitySummarySchema = z
  .object({
    entityId: UuidSchema,
    definitionId: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(240),
    definitionType: z.string().trim().min(1).max(100),
    locationId: UuidSchema.nullable(),
    condition: z.number().int().min(0).max(100).optional(),
    lifecycleStatus: z.string().trim().min(1).max(80),
    version: z.number().int().nonnegative(),
    visibility: z.enum(["player_known", "authoritative_hidden"]),
    relevanceScore: z.number().int().min(-100_000).max(100_000),
    inclusionReasons: z.array(ContextInclusionReasonSchema).min(1).max(16),
  })
  .strict();

export const RelevanceCompiledContextSchema = z
  .object({
    compilationId: UuidSchema,
    policyVersion: z.string().trim().min(1).max(120),
    worldId: UuidSchema,
    shardId: UuidSchema,
    viewpointId: UuidSchema,
    commandExcerpt: z.string().max(500),
    entities: z.array(ContextEntitySummarySchema).max(96),
    playerKnownFacts: z.array(RelevanceContextFactSchema).max(192),
    authoritativeHiddenFacts: z.array(RelevanceContextFactSchema).max(192),
    omittedCandidateCount: z.number().int().nonnegative(),
    estimatedTokens: z.number().int().nonnegative(),
  })
  .strict();
export type RelevanceCompiledContext = z.infer<typeof RelevanceCompiledContextSchema>;
