import { z } from "zod";

export const ActionIntentSchema = z.object({
  actorId: z.string().min(1),
  rawText: z.string().min(1),
  actionType: z.string().min(1),
  targetIds: z.array(z.string()).default([]),
  methodDefinitionIds: z.array(z.string()).default([]),
  objective: z.string().min(1),
  intensity: z.enum(["careful", "normal", "urgent", "maximum"]).default("normal"),
  assumptions: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});

export type ActionIntent = z.infer<typeof ActionIntentSchema>;
