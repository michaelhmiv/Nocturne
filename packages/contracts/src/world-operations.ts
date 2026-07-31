import { z } from "zod";

const UuidSchema = z.string().uuid();
const SymbolSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const SlugSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const TextSchema = z.string().trim().min(1).max(2_000);
const JsonObjectSchema = z.record(z.string(), z.unknown());

export const WorldEntityReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), entityId: UuidSchema }).strict(),
  z.object({ kind: z.literal("symbol"), symbol: SymbolSchema }).strict(),
]);
export type WorldEntityReference = z.infer<typeof WorldEntityReferenceSchema>;

export const WorldDefinitionReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), definitionId: z.string().trim().min(1).max(160) }).strict(),
  z.object({ kind: z.literal("symbol"), symbol: SymbolSchema }).strict(),
]);
export type WorldDefinitionReference = z.infer<typeof WorldDefinitionReferenceSchema>;

const PreconditionsSchema = z
  .object({
    preconditionFactIds: z.array(z.string().trim().min(1).max(160)).max(16).default([]),
  })
  .strict();

const withPreconditions = <T extends z.ZodRawShape>(shape: T) =>
  z.object({ ...shape, ...PreconditionsSchema.shape }).strict();

export const CreateDefinitionWorldOperationSchema = withPreconditions({
  type: z.literal("create_definition"),
  symbol: SymbolSchema,
  definitionType: SlugSchema,
  name: z.string().trim().min(1).max(200),
  conceptSummary: TextSchema,
  originSource: z.string().trim().min(1).max(120).optional(),
  lifecycleStatus: z.enum(["provisional", "approved", "retired"]).default("approved"),
});

export const CreateRevisionWorldOperationSchema = withPreconditions({
  type: z.literal("create_revision"),
  symbol: SymbolSchema.optional(),
  definitionRef: WorldDefinitionReferenceSchema,
  schemaVersion: z.string().trim().min(1).max(80).default("content-v1"),
  payload: JsonObjectSchema,
  changeSummary: z.string().trim().min(1).max(500),
});

export const CreateInstanceWorldOperationSchema = withPreconditions({
  type: z.literal("create_instance"),
  symbol: SymbolSchema,
  definitionRef: WorldDefinitionReferenceSchema,
  locationRef: WorldEntityReferenceSchema.optional(),
  ownerRef: WorldEntityReferenceSchema.optional(),
  controllerRef: WorldEntityReferenceSchema.optional(),
  condition: z.number().int().min(0).max(100).default(100),
  state: JsonObjectSchema.default({}),
  provenance: z
    .object({
      sourceType: z.enum([
        "seed",
        "migration",
        "ai_materialization",
        "ambient_pool",
        "population_reservoir",
        "prior_event",
        "player_creation",
        "crafting",
        "invention",
        "scheduled_arrival",
        "administrative_repair",
      ]),
      sourceId: z.string().trim().min(1).max(200).optional(),
      policyVersion: z.string().trim().min(1).max(120).optional(),
      inputHash: z.string().trim().min(1).max(160).optional(),
      payload: JsonObjectSchema.default({}),
    })
    .strict(),
});

export const RetireEntityWorldOperationSchema = withPreconditions({
  type: z.literal("retire_entity"),
  entityRef: WorldEntityReferenceSchema,
  expectedVersion: z.number().int().nonnegative(),
  lifecycleStatus: z.enum(["dead", "destroyed", "retired", "merged"]),
  reason: TextSchema,
  survivingEntityRef: WorldEntityReferenceSchema.optional(),
});

export const MoveEntityWorldOperationSchema = withPreconditions({
  type: z.literal("move_entity"),
  entityRef: WorldEntityReferenceSchema,
  locationRef: WorldEntityReferenceSchema,
  expectedVersion: z.number().int().nonnegative().optional(),
  expectedLocationRef: WorldEntityReferenceSchema.nullable().optional(),
});

export const TransferOwnershipWorldOperationSchema = withPreconditions({
  type: z.literal("transfer_ownership"),
  entityRef: WorldEntityReferenceSchema,
  ownerRef: WorldEntityReferenceSchema.nullable(),
  expectedVersion: z.number().int().nonnegative().optional(),
});

export const TransferPossessionWorldOperationSchema = withPreconditions({
  type: z.literal("transfer_possession"),
  entityRef: WorldEntityReferenceSchema,
  possessorRef: WorldEntityReferenceSchema.nullable(),
  expectedVersion: z.number().int().nonnegative().optional(),
});

export const SetControllerWorldOperationSchema = withPreconditions({
  type: z.literal("set_controller"),
  entityRef: WorldEntityReferenceSchema,
  controllerRef: WorldEntityReferenceSchema.nullable(),
  expectedVersion: z.number().int().nonnegative().optional(),
});

const RelationParametersSchema = z.record(z.string(), z.unknown()).default({});

export const SetRelationWorldOperationSchema = withPreconditions({
  type: z.literal("set_relation"),
  sourceRef: WorldEntityReferenceSchema,
  targetRef: WorldEntityReferenceSchema,
  relationType: SlugSchema,
  parameters: RelationParametersSchema,
});

export const RemoveRelationWorldOperationSchema = withPreconditions({
  type: z.literal("remove_relation"),
  sourceRef: WorldEntityReferenceSchema,
  targetRef: WorldEntityReferenceSchema,
  relationType: SlugSchema,
});

export const SetAccessWorldOperationSchema = withPreconditions({
  type: z.literal("set_access"),
  subjectRef: WorldEntityReferenceSchema,
  resourceRef: WorldEntityReferenceSchema,
  access: z.enum(["grant", "revoke"]),
  parameters: RelationParametersSchema,
});

export const SetConditionWorldOperationSchema = withPreconditions({
  type: z.literal("set_condition"),
  entityRef: WorldEntityReferenceSchema,
  condition: SlugSchema,
  active: z.boolean(),
  intensity: z.number().int().min(0).max(100).optional(),
  durationSeconds: z.number().int().positive().max(31_536_000).optional(),
  metadata: JsonObjectSchema.default({}),
  expectedVersion: z.number().int().nonnegative().optional(),
});

export const AdjustConditionWorldOperationSchema = withPreconditions({
  type: z.literal("adjust_condition"),
  entityRef: WorldEntityReferenceSchema,
  delta: z.number().int().min(-100).max(100),
  expectedVersion: z.number().int().nonnegative().optional(),
});

export const AdjustResourceWorldOperationSchema = withPreconditions({
  type: z.literal("adjust_resource"),
  entityRef: WorldEntityReferenceSchema,
  resource: SlugSchema,
  delta: z.number().min(-1_000_000_000).max(1_000_000_000),
  minimum: z.number().min(-1_000_000_000).max(1_000_000_000).optional(),
  maximum: z.number().min(-1_000_000_000).max(1_000_000_000).optional(),
  expectedVersion: z.number().int().nonnegative().optional(),
});

export const SetStateValueWorldOperationSchema = withPreconditions({
  type: z.literal("set_state_value"),
  entityRef: WorldEntityReferenceSchema,
  path: z.array(SlugSchema).min(1).max(8),
  value: z.unknown(),
  expectedVersion: z.number().int().nonnegative().optional(),
});

export const RemoveStateValueWorldOperationSchema = withPreconditions({
  type: z.literal("remove_state_value"),
  entityRef: WorldEntityReferenceSchema,
  path: z.array(SlugSchema).min(1).max(8),
  expectedVersion: z.number().int().nonnegative().optional(),
});

export const CreateKnowledgeWorldOperationSchema = withPreconditions({
  type: z.literal("create_information_asset"),
  holderRef: WorldEntityReferenceSchema,
  subjectRef: WorldEntityReferenceSchema.optional(),
  content: TextSchema,
  confidenceBasisPoints: z.number().int().min(0).max(10_000),
  truthStatus: z.enum(["observation", "inference", "rumor"]),
});

export const InvalidateKnowledgeWorldOperationSchema = withPreconditions({
  type: z.literal("invalidate_information_asset"),
  informationId: UuidSchema,
  reason: TextSchema,
});

export const ScheduleTimedWorkWorldOperationSchema = withPreconditions({
  type: z.literal("schedule_timed_work"),
  symbol: SymbolSchema.optional(),
  kind: SlugSchema,
  subjectRefs: z.array(WorldEntityReferenceSchema).min(1).max(32),
  description: TextSchema,
  durationSeconds: z.number().int().positive().max(31_536_000),
  payload: JsonObjectSchema.default({}),
  expectedVersions: z.record(UuidSchema, z.number().int().nonnegative()).default({}),
});

export const CancelTimedWorkWorldOperationSchema = withPreconditions({
  type: z.literal("cancel_timed_work"),
  scheduleId: UuidSchema,
  reason: TextSchema,
});

export const ApplyAreaEffectWorldOperationSchema = withPreconditions({
  type: z.literal("apply_area_effect"),
  symbol: SymbolSchema.optional(),
  areaRef: WorldEntityReferenceSchema,
  effect: z.string().trim().min(1).max(200),
  intensity: z.number().int().min(0).max(100).default(100),
  durationSeconds: z.number().int().positive().max(31_536_000).optional(),
  metadata: JsonObjectSchema.default({}),
});

export const RemoveAreaEffectWorldOperationSchema = withPreconditions({
  type: z.literal("remove_area_effect"),
  areaEffectId: UuidSchema,
  reason: TextSchema,
});

export const UniversalWorldOperationSchema = z.discriminatedUnion("type", [
  CreateDefinitionWorldOperationSchema,
  CreateRevisionWorldOperationSchema,
  CreateInstanceWorldOperationSchema,
  RetireEntityWorldOperationSchema,
  MoveEntityWorldOperationSchema,
  TransferOwnershipWorldOperationSchema,
  TransferPossessionWorldOperationSchema,
  SetControllerWorldOperationSchema,
  SetRelationWorldOperationSchema,
  RemoveRelationWorldOperationSchema,
  SetAccessWorldOperationSchema,
  SetConditionWorldOperationSchema,
  AdjustConditionWorldOperationSchema,
  AdjustResourceWorldOperationSchema,
  SetStateValueWorldOperationSchema,
  RemoveStateValueWorldOperationSchema,
  CreateKnowledgeWorldOperationSchema,
  InvalidateKnowledgeWorldOperationSchema,
  ScheduleTimedWorkWorldOperationSchema,
  CancelTimedWorkWorldOperationSchema,
  ApplyAreaEffectWorldOperationSchema,
  RemoveAreaEffectWorldOperationSchema,
]);

export type UniversalWorldOperation = z.infer<typeof UniversalWorldOperationSchema>;

export const MAX_UNIVERSAL_WORLD_OPERATIONS = 48;

export const UniversalWorldOperationBranchSchema = z
  .object({
    operations: z
      .array(UniversalWorldOperationSchema)
      .min(1)
      .max(MAX_UNIVERSAL_WORLD_OPERATIONS),
  })
  .strict()
  .superRefine(({ operations }, context) => {
    const symbols = new Set<string>();
    for (const [index, operation] of operations.entries()) {
      if ("symbol" in operation && operation.symbol) {
        if (symbols.has(operation.symbol)) {
          context.addIssue({
            code: "custom",
            path: ["operations", index, "symbol"],
            message: "Operation symbols must be unique inside a branch",
          });
        }
        symbols.add(operation.symbol);
      }
    }
  });

export type UniversalWorldOperationBranch = z.infer<typeof UniversalWorldOperationBranchSchema>;

export const UniversalMutationReceiptSchema = z
  .object({
    receiptId: UuidSchema,
    eventId: UuidSchema,
    worldId: UuidSchema,
    shardId: UuidSchema,
    idempotencyKey: z.string().trim().min(1).max(240),
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    authority: z.enum(["player", "scheduled", "world_simulation", "operator"]),
    actorId: UuidSchema.optional(),
    symbolMap: z.record(SymbolSchema, z.string().trim().min(1).max(200)),
    operationResults: z.array(JsonObjectSchema).max(MAX_UNIVERSAL_WORLD_OPERATIONS),
    playerVisibleFacts: z.array(TextSchema).max(64),
    hiddenFacts: z.array(TextSchema).max(64),
    createdAt: z.string().datetime(),
    idempotentReplay: z.boolean().default(false),
  })
  .strict();

export type UniversalMutationReceipt = z.infer<typeof UniversalMutationReceiptSchema>;
