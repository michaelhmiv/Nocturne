import { z } from "zod";
import { RelevanceContextFactSchema } from "./relevance-context.js";

const UuidSchema = z.string().uuid();
const ShortTextSchema = z.string().trim().min(1).max(1_000);
const NarrativeTextSchema = z.string().trim().min(1).max(8_000);

export const GameConstitutionSchema = z
  .object({
    version: z.string().trim().min(1).max(120),
    purpose: z.array(ShortTextSchema).min(1).max(16),
    improvisationRules: z.array(ShortTextSchema).min(1).max(24),
    persistenceRules: z.array(ShortTextSchema).min(1).max(24),
    authorityRules: z.array(ShortTextSchema).min(1).max(24),
    toneRules: z.array(ShortTextSchema).min(1).max(16),
  })
  .strict();
export type GameConstitution = z.infer<typeof GameConstitutionSchema>;

export const SceneContextSchema = z
  .object({
    locationId: UuidSchema.nullable(),
    locationName: z.string().trim().min(1).max(240),
    locationDescription: z.string().trim().max(4_000),
    summary: z.string().trim().max(4_000),
    unresolvedThreads: z.array(ShortTextSchema).max(24),
  })
  .strict();
export type SceneContext = z.infer<typeof SceneContextSchema>;

export const RecentTurnSchema = z
  .object({
    requestId: UuidSchema,
    command: NarrativeTextSchema,
    playerSafeResult: NarrativeTextSchema,
    eventIds: z.array(UuidSchema).max(64),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type RecentTurn = z.infer<typeof RecentTurnSchema>;

export const NarrativeMemorySchema = z
  .object({
    memoryId: UuidSchema,
    summary: NarrativeTextSchema,
    sourceEventIds: z.array(UuidSchema).min(1).max(64),
    mentionedEntityIds: z.array(UuidSchema).max(64),
    locationId: UuidSchema.nullable(),
    salience: z.number().int().min(-10_000).max(10_000),
    visibility: z.literal("player_known"),
    unresolved: z.boolean(),
    occurredAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type NarrativeMemory = z.infer<typeof NarrativeMemorySchema>;

export const GameMasterContextSchema = z
  .object({
    constitution: GameConstitutionSchema,
    currentCommand: NarrativeTextSchema,
    currentScene: SceneContextSchema,
    recentTurns: z.array(RecentTurnSchema).max(12),
    relevantMemories: z.array(NarrativeMemorySchema).max(32),
    playerKnownFacts: z.array(RelevanceContextFactSchema).max(192),
    activePlan: z.record(z.string(), z.unknown()).nullable(),
    estimatedTokens: z.number().int().nonnegative(),
  })
  .strict();
export type GameMasterContext = z.infer<typeof GameMasterContextSchema>;

export const AiContextConsumptionModeSchema = z.enum([
  "none",
  "constitution_only",
  "player_safe_context",
  "authoritative_context",
]);
export type AiContextConsumptionMode = z.infer<typeof AiContextConsumptionModeSchema>;
