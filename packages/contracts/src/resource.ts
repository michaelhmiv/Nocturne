import { z } from "zod";

export const WORLD_RESOURCE_KEYS = [
  "ammunition",
  "charge",
  "durability",
  "fatigue",
  "fuel",
  "heat",
  "hunger",
  "hydration",
  "nutrition",
  "quantity",
  "stamina",
  "thirst",
  "time_seconds",
] as const;

export const WorldResourceKeySchema = z.enum(WORLD_RESOURCE_KEYS);
export type WorldResourceKey = z.infer<typeof WorldResourceKeySchema>;

export const WORLD_RESOURCE_LIMITS: Record<
  WorldResourceKey,
  { minimum: number; maximum: number }
> = {
  ammunition: { minimum: 0, maximum: 1_000_000 },
  charge: { minimum: 0, maximum: 100 },
  durability: { minimum: 0, maximum: 100 },
  fatigue: { minimum: 0, maximum: 100 },
  fuel: { minimum: 0, maximum: 1_000_000 },
  heat: { minimum: 0, maximum: 100 },
  hunger: { minimum: 0, maximum: 100 },
  hydration: { minimum: 0, maximum: 100 },
  nutrition: { minimum: 0, maximum: 100 },
  quantity: { minimum: 0, maximum: 1_000_000_000 },
  stamina: { minimum: 0, maximum: 100 },
  thirst: { minimum: 0, maximum: 100 },
  time_seconds: { minimum: 0, maximum: 31_536_000 },
};

export function worldResourceLimits(resource: WorldResourceKey) {
  return WORLD_RESOURCE_LIMITS[resource];
}
