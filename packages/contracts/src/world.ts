import { z } from "zod";

export const StarterWorldSchema = z.object({
  city: z.object({ id: z.string().uuid(), name: z.string() }),
  district: z.object({ id: z.string().uuid(), name: z.string() }),
  neighborhood: z.object({ id: z.string().uuid(), name: z.string() }),
  building: z.object({ id: z.string().uuid(), name: z.string() }),
  residence: z.object({
    id: z.string().uuid(),
    name: z.string(),
    occupiedByCharacterId: z.string().uuid().nullable(),
    capacities: z.record(z.string(), z.number()),
  }),
  alley: z.object({ id: z.string().uuid(), name: z.string() }),
});

export const RentResidenceInputSchema = z.object({
  characterId: z.string().uuid(),
});

export const RentResidenceResultSchema = z.object({
  characterId: z.string().uuid(),
  residenceId: z.string().uuid(),
  eventId: z.string().uuid(),
  alreadyRented: z.boolean(),
});

export type StarterWorld = z.infer<typeof StarterWorldSchema>;
export type RentResidenceInput = z.infer<typeof RentResidenceInputSchema>;
export type RentResidenceResult = z.infer<typeof RentResidenceResultSchema>;
