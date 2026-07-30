import { z } from "zod";

export const SceneEntitySchema = z.object({
  instanceId: z.string().uuid(),
  name: z.string().min(1),
  relationship: z.enum(["visible", "owned"]),
});

export const SceneOpportunitySchema = z.object({
  opportunityId: z.string().min(1),
  label: z.string().min(1),
  suggestedAction: z.string().min(1),
});

export const SceneProjectionSchema = z.object({
  character: z
    .object({
      characterId: z.string().uuid(),
      name: z.string().min(1),
      conceptSummary: z.string(),
      cashOnPerson: z.number().int(),
      heat: z.number(),
      warrant: z.boolean(),
      status: z.string(),
    })
    .nullable(),
  location: z.object({
    locationId: z.string().uuid().nullable(),
    name: z.string().min(1),
    area: z.string().min(1),
    atmosphere: z.string().min(1),
  }),
  visibleEntities: z.array(SceneEntitySchema),
  ownedEntities: z.array(SceneEntitySchema),
  discoveries: z.array(z.string().min(1)),
  opportunities: z.array(SceneOpportunitySchema),
  generatedAt: z.string().datetime(),
});

export type SceneEntity = z.infer<typeof SceneEntitySchema>;
export type SceneOpportunity = z.infer<typeof SceneOpportunitySchema>;
export type SceneProjection = z.infer<typeof SceneProjectionSchema>;
