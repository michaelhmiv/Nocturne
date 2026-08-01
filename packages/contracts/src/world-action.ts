import { z } from "zod";
import { PersistentActionPlanProposalSchema, PersistentActionPlanSchema } from "./action-plans.js";
import { GameMasterContextSchema } from "./game-master-context.js";

const UuidSchema = z.string().uuid();
const TextSchema = z.string().trim().min(1).max(4_000);

export const WorldActionKindSchema = z.enum([
  "search",
  "move",
  "consume",
  "relationship",
  "combat",
  "transfer",
  "interact",
  "dialogue",
  "question",
]);
export type WorldActionKind = z.infer<typeof WorldActionKindSchema>;

export const WorldActionPlannerRequestSchema = z
  .object({
    command: TextSchema,
    actorId: UuidSchema,
    playerKnownFacts: z.array(z.record(z.string(), z.unknown())).max(192),
    resolvedEntityIds: z.array(UuidSchema).max(32),
    activePlanSummary: z.record(z.string(), z.unknown()).nullable(),
    enabledHandlers: z.array(WorldActionKindSchema).min(1),
    gameMasterContext: GameMasterContextSchema,
  })
  .strict();
export type WorldActionPlannerRequest = z.infer<typeof WorldActionPlannerRequestSchema>;

export const WorldActionPlannerResultSchema = z
  .object({
    primaryKind: WorldActionKindSchema,
    requiresClarification: z.boolean(),
    clarificationPrompt: z.string().trim().min(1).max(500).optional(),
    plan: PersistentActionPlanProposalSchema.optional(),
    rationale: z.string().trim().min(1).max(1_000),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.requiresClarification !== Boolean(result.clarificationPrompt)) {
      context.addIssue({
        code: "custom",
        path: ["clarificationPrompt"],
        message: "Clarification state and prompt must agree",
      });
    }
    if (!result.requiresClarification && !result.plan) {
      context.addIssue({
        code: "custom",
        path: ["plan"],
        message: "Executable world actions require a persistent plan",
      });
    }
  });
export type WorldActionPlannerResult = z.infer<typeof WorldActionPlannerResultSchema>;

export const WorldActionRequestSchema = z
  .object({
    command: TextSchema,
    actorId: UuidSchema.optional(),
  })
  .strict();

export const WorldActionPlayerSafeResultSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("waiting_for_clarification"),
      requestId: UuidSchema,
      prompt: z.string().trim().min(1).max(500),
    })
    .strict(),
  z
    .object({
      state: z.literal("waiting"),
      requestId: UuidSchema,
      plan: PersistentActionPlanSchema,
      narration: TextSchema,
    })
    .strict(),
  z
    .object({
      state: z.literal("completed"),
      requestId: UuidSchema,
      plan: PersistentActionPlanSchema,
      narration: TextSchema,
      eventIds: z.array(UuidSchema).max(64),
    })
    .strict(),
]);
export type WorldActionPlayerSafeResult = z.infer<typeof WorldActionPlayerSafeResultSchema>;
