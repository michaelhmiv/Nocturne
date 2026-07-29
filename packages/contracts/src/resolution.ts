import { z } from "zod";

export const OutcomeGradeSchema = z.enum([
  "complete_success",
  "success_with_consequence",
  "partial_success",
  "failure_with_progress",
  "failure",
  "catastrophic_reversal",
]);

export type OutcomeGrade = z.infer<typeof OutcomeGradeSchema>;

export function outcomeGradeForMarginBasisPoints(marginBasisPoints: number): OutcomeGrade {
  if (marginBasisPoints >= 2_000) return "complete_success";
  if (marginBasisPoints >= 500) return "success_with_consequence";
  if (marginBasisPoints >= 0) return "partial_success";
  if (marginBasisPoints > -500) return "failure_with_progress";
  if (marginBasisPoints > -2_000) return "failure";
  return "catastrophic_reversal";
}

export const ResolutionModifierSchema = z.object({
  factorId: z.string().min(1),
  value: z.number().int().min(-5).max(5),
  reason: z.string().min(1),
  sourceId: z.string().optional(),
});

export const CreateInformationAssetOperationSchema = z.object({
  type: z.literal("create_information_asset"),
  holderId: z.string().uuid(),
  subjectId: z.string().uuid().optional(),
  content: z.string().min(1),
  confidence: z.number().min(0).max(1),
  truthStatus: z.enum(["observation", "inference", "rumor"]).default("observation"),
});
export const ConsumeResourceOperationSchema = z.object({
  type: z.literal("consume_resource"),
  instanceId: z.string().uuid(),
  resource: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
  amount: z.number().positive(),
});
export const SetInstanceStateOperationSchema = z.object({
  type: z.literal("set_instance_state"),
  instanceId: z.string().uuid(),
  path: z
    .array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/))
    .min(1)
    .max(4),
  value: z.unknown(),
});
export const ChangeInstanceConditionOperationSchema = z.object({
  type: z.literal("change_instance_condition"),
  instanceId: z.string().uuid(),
  delta: z.number().int().min(-100).max(100),
});
export const StateOperationSchema = z.discriminatedUnion("type", [
  CreateInformationAssetOperationSchema,
  ConsumeResourceOperationSchema,
  SetInstanceStateOperationSchema,
  ChangeInstanceConditionOperationSchema,
]);

const OpaqueIdSchema = z.string().trim().min(1).max(128);
const OperationTextSchema = z.string().trim().min(1).max(1_000);
const BasisPointsSchema = z.number().int().min(0).max(10_000);
const preconditions = { preconditionFactIds: z.array(OpaqueIdSchema).max(8) };
const operation = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ ...shape, ...preconditions }).strict();

export const MAX_STATE_OPERATIONS = 16;
export const ConversationStateOperationSchema = z.discriminatedUnion("type", [
  operation({
    type: z.literal("create_definition"),
    name: z.string().trim().min(1).max(200),
    definitionId: OpaqueIdSchema,
    definitionKind: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  }),
  operation({
    type: z.literal("create_revision"),
    revisionId: OpaqueIdSchema,
    definitionId: OpaqueIdSchema,
    patch: OperationTextSchema,
  }),
  operation({
    type: z.literal("create_instance"),
    instanceId: OpaqueIdSchema,
    definitionId: OpaqueIdSchema,
    name: z.string().trim().min(1).max(200),
  }),
  operation({
    type: z.literal("acquire_entity"),
    ownerId: OpaqueIdSchema,
    entityId: OpaqueIdSchema,
  }),
  operation({
    type: z.literal("move_entity"),
    entityId: OpaqueIdSchema,
    locationId: OpaqueIdSchema,
  }),
  operation({
    type: z.literal("set_relationship"),
    sourceId: OpaqueIdSchema,
    targetId: OpaqueIdSchema,
    relationship: z.string().trim().min(1).max(100),
    value: z.number().int().min(-100).max(100),
  }),
  operation({
    type: z.literal("set_access"),
    subjectId: OpaqueIdSchema,
    resourceId: OpaqueIdSchema,
    access: z.enum(["grant", "revoke"]),
  }),
  operation({
    type: z.literal("set_condition"),
    entityId: OpaqueIdSchema,
    condition: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    active: z.boolean(),
  }),
  operation({
    type: z.literal("adjust_resource"),
    entityId: OpaqueIdSchema,
    resource: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    delta: z.number().int().min(-1_000_000).max(1_000_000),
  }),
  operation({
    type: z.literal("create_information_asset"),
    holderId: OpaqueIdSchema,
    subjectId: OpaqueIdSchema.optional(),
    content: OperationTextSchema,
    confidenceBasisPoints: BasisPointsSchema,
    truthStatus: z.enum(["observation", "inference", "rumor"]),
  }),
  operation({
    type: z.literal("schedule_timed_work"),
    workerId: OpaqueIdSchema,
    workId: OpaqueIdSchema,
    description: OperationTextSchema,
    durationSeconds: z.number().int().positive().max(31_536_000),
  }),
  operation({
    type: z.literal("apply_area_effect"),
    areaId: OpaqueIdSchema,
    effect: z.string().trim().min(1).max(200),
    active: z.boolean(),
    durationSeconds: z.number().int().positive().max(31_536_000).optional(),
  }),
]);

export const ResolutionResultSchema = z.object({
  outcomeGrade: OutcomeGradeSchema,
  margin: z.number().int(),
  uncertainty: z.number().int(),
  modifiers: z.array(ResolutionModifierSchema),
  calculationTrace: z.array(z.string().min(1)),
  stateOperations: z.array(StateOperationSchema).default([]),
  narrativeConstraints: z.array(z.string()).default([]),
});

export type ResolutionModifier = z.infer<typeof ResolutionModifierSchema>;
export type StateOperation = z.infer<typeof StateOperationSchema>;
export type ConversationStateOperation = z.infer<typeof ConversationStateOperationSchema>;
export type ResolutionResult = z.infer<typeof ResolutionResultSchema>;
