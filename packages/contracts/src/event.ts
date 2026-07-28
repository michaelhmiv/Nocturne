import { z } from "zod";

export const WorldEventSchema = z.object({
  eventId: z.string().uuid(),
  worldTime: z.string().datetime(),
  eventType: z.string().min(1),
  involvedEntityIds: z.array(z.string()).default([]),
  payload: z.record(z.string(), z.unknown()),
  sourceIntentId: z.string().uuid().optional(),
  supersedesEventId: z.string().uuid().optional(),
});

export type WorldEvent = z.infer<typeof WorldEventSchema>;
