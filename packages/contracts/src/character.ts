import { z } from "zod";

export const CreateCharacterInputSchema = z.object({
  name: z.string().trim().min(2).max(80),
  conceptSummary: z.string().trim().min(10).max(1_000),
  originSource: z.string().trim().min(1).max(80).default("human"),
  qualities: z.record(z.string(), z.unknown()).default({}),
});

export const CharacterSummarySchema = z.object({
  characterId: z.string().uuid(),
  definitionId: z.string().min(1),
  name: z.string().min(1),
  conceptSummary: z.string().min(1),
  originSource: z.string().nullable(),
  selected: z.boolean(),
  locationId: z.string().uuid().nullable(),
  residenceId: z.string().uuid().nullable(),
  residenceName: z.string().nullable().default(null),
  createdAt: z.string().datetime(),
  // Phase UI/cash
  cashOnPerson: z.number().int().nonnegative().default(0),
  heat: z.number().int().nonnegative().default(0),
  warrant: z.boolean().default(false),
  status: z.string().default("active"),
  factionStanding: z.record(z.string(), z.number()).default({}),
  skills: z.record(z.string(), z.number()).default({}),
  inventory: z.array(z.record(z.string(), z.unknown())).default([]),
});

export type CreateCharacterInput = z.infer<typeof CreateCharacterInputSchema>;
export type CharacterSummary = z.infer<typeof CharacterSummarySchema>;
