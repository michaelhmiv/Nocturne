import { z } from "zod";

const UuidSchema = z.string().uuid();
const SlugSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

export const RelationshipFamilySchema = z.enum([
  "knowledge",
  "physical",
  "possession",
  "ownership",
  "control",
  "custody",
  "accompaniment",
  "social",
  "hostility",
  "residence",
  "access",
  "assignment",
  "organization",
  "other",
]);

export const NormalizedRelationshipSchema = z
  .object({
    relationId: UuidSchema,
    sourceId: UuidSchema,
    targetId: UuidSchema,
    relationType: SlugSchema,
    family: RelationshipFamilySchema,
    parameters: z.record(z.string(), z.unknown()),
    visibility: z.enum(["player_known", "authoritative_hidden"]),
    validUntil: z.string().datetime().nullable(),
  })
  .strict();
export type NormalizedRelationship = z.infer<typeof NormalizedRelationshipSchema>;

export const EffectiveLocationSchema = z
  .object({
    entityId: UuidSchema,
    immediateLocationId: UuidSchema.nullable(),
    effectiveLocationId: UuidSchema.nullable(),
    containmentChain: z.array(UuidSchema).max(32),
    derivedFromRelationTypes: z.array(SlugSchema).max(32),
  })
  .strict();
export type EffectiveLocation = z.infer<typeof EffectiveLocationSchema>;

export const TravelCohortMemberSchema = z
  .object({
    entityId: UuidSchema,
    role: z.enum([
      "leader",
      "vehicle",
      "passenger",
      "carried",
      "following",
      "restrained",
      "companion",
    ]),
    required: z.boolean(),
    expectedVersion: z.number().int().nonnegative(),
    expectedLocationId: UuidSchema.nullable(),
    validation: z.record(z.string(), z.unknown()),
  })
  .strict();

export const TravelCohortSchema = z
  .object({
    cohortId: UuidSchema,
    leaderId: UuidSchema,
    destinationId: UuidSchema,
    status: z.enum(["assembled", "traveling", "arrived", "separated", "cancelled", "failed"]),
    members: z.array(TravelCohortMemberSchema).min(1).max(64),
  })
  .strict()
  .superRefine((cohort, context) => {
    const leaders = cohort.members.filter(({ role }) => role === "leader");
    if (leaders.length !== 1 || leaders[0]?.entityId !== cohort.leaderId) {
      context.addIssue({
        code: "custom",
        path: ["members"],
        message: "Travel cohort must contain exactly one matching leader",
      });
    }
    if (new Set(cohort.members.map(({ entityId }) => entityId)).size !== cohort.members.length) {
      context.addIssue({
        code: "custom",
        path: ["members"],
        message: "Travel cohort members must be unique",
      });
    }
  });
export type TravelCohort = z.infer<typeof TravelCohortSchema>;
