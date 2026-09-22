import { z } from "zod";
import {
  CategoryFamilySchema,
  SandboxPrimitiveSchema,
  SandboxSelectorSchema,
  TravelModeSchema,
  type SandboxPrimitive,
} from "./sandbox-systems.js";
import { WorldActionKindSchema, type WorldActionKind } from "./world-action.js";
import { UniversalWorldOperationSchema, type UniversalWorldOperation } from "./world-operations.js";

const UuidSchema = z.string().uuid();
const TextSchema = z.string().trim().min(1).max(4_000);

export const MUTATING_PRIMITIVES: readonly SandboxPrimitive[] = [
  "travel",
  "search",
  "operate",
  "transfer",
  "consume",
  "damage",
  "repair",
  "restrain",
  "release",
  "wait",
  "work",
  "occupy",
  "communicate",
];

export const KIND_TO_PRIMITIVE: Record<WorldActionKind, SandboxPrimitive> = {
  search: "search",
  move: "travel",
  consume: "consume",
  relationship: "communicate",
  combat: "damage",
  transfer: "transfer",
  interact: "operate",
  dialogue: "communicate",
  question: "perceive",
};

export const EngineConstraintSchema = z
  .object({
    durationSeconds: z.number().int().positive().max(31_536_000).optional(),
    pay: z.boolean().optional(),
    stealth: z.boolean().optional(),
    force: z.boolean().optional(),
    hoursRequired: z.boolean().optional(),
  })
  .strict();
export type EngineConstraint = z.infer<typeof EngineConstraintSchema>;

export const EngineIntentSchema = z
  .object({
    worldId: UuidSchema,
    shardId: UuidSchema,
    actorId: UuidSchema,
    requestId: UuidSchema,
    primitive: SandboxPrimitiveSchema,
    category: CategoryFamilySchema.optional(),
    selector: SandboxSelectorSchema.default("nearest"),
    travelMode: TravelModeSchema.optional(),
    explicitEntityIds: z.array(UuidSchema).max(32).default([]),
    constraints: EngineConstraintSchema.default({}),
    rawText: TextSchema,
  })
  .strict();
export type EngineIntent = z.infer<typeof EngineIntentSchema>;

export const EngineBindStatusSchema = z.enum([
  "bound",
  "materialize_from_source",
  "need_source",
  "need_traverse",
  "unsupported",
  "impossible",
  "clarify_known_conflict",
]);
export type EngineBindStatus = z.infer<typeof EngineBindStatusSchema>;

export const EngineBoundTargetSchema = z
  .object({
    entityId: UuidSchema.optional(),
    sourceKey: z.string().trim().min(1).max(200).optional(),
    family: CategoryFamilySchema.optional(),
    name: z.string().trim().min(1).max(200).optional(),
    distanceMeters: z.number().nonnegative().optional(),
    lon: z.number().optional(),
    lat: z.number().optional(),
    known: z.boolean().default(false),
    playable: z.boolean().default(false),
  })
  .strict();
export type EngineBoundTarget = z.infer<typeof EngineBoundTargetSchema>;

export const EngineDecisionSchema = z
  .object({
    intent: EngineIntentSchema,
    status: EngineBindStatusSchema,
    target: EngineBoundTargetSchema.optional(),
    conflictNames: z.array(z.string().trim().min(1).max(200)).max(8).default([]),
    operations: z.array(UniversalWorldOperationSchema).max(48).default([]),
    playerVisibleFacts: z.array(z.string().trim().min(1).max(2_000)).max(64).default([]),
    rationale: z.string().trim().min(1).max(1_500),
    requiresClarification: z.boolean(),
    clarificationPrompt: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((decision, context) => {
    if (decision.requiresClarification !== (decision.status === "clarify_known_conflict")) {
      context.addIssue({
        code: "custom",
        path: ["requiresClarification"],
        message: "Clarification is only legal for known-instance conflicts.",
      });
    }
    if (decision.requiresClarification !== Boolean(decision.clarificationPrompt)) {
      context.addIssue({
        code: "custom",
        path: ["clarificationPrompt"],
        message: "Clarification state and prompt must agree.",
      });
    }
    if (
      decision.operations.length > 0 &&
      (decision.status === "need_source" ||
        decision.status === "unsupported" ||
        decision.status === "impossible" ||
        decision.status === "clarify_known_conflict")
    ) {
      context.addIssue({
        code: "custom",
        path: ["operations"],
        message: "Unresolved or impossible intents cannot emit mutations.",
      });
    }
  });
export type EngineDecision = z.infer<typeof EngineDecisionSchema>;

export function isMutatingPrimitive(primitive: SandboxPrimitive): boolean {
  return MUTATING_PRIMITIVES.includes(primitive);
}

export function primitiveForKind(kind: WorldActionKind): SandboxPrimitive {
  return KIND_TO_PRIMITIVE[WorldActionKindSchema.parse(kind)];
}

export function inventedSuccess(decision: {
  status: EngineBindStatus;
  operations: readonly UniversalWorldOperation[];
}): boolean {
  return (
    decision.operations.length > 0 &&
    (decision.status === "need_source" ||
      decision.status === "unsupported" ||
      decision.status === "impossible" ||
      decision.status === "clarify_known_conflict")
  );
}
