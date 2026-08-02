import { z } from "zod";
import { WorldActionKindSchema } from "./world-action.js";

const UuidSchema = z.string().uuid();
const SlugSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const TextSchema = z.string().trim().min(1).max(4_000);
const DemandSchema = z.number().int().min(0).max(10);

export const SemanticActionPropertiesSchema = z
  .object({
    selfDirected: z.boolean(),
    opposed: z.boolean(),
    destructive: z.boolean(),
    illegal: z.boolean(),
    social: z.boolean(),
    movement: z.boolean(),
    continuous: z.boolean(),
  })
  .strict();

export const SemanticActionDemandsSchema = z
  .object({
    physicalEffort: DemandSchema,
    technicalComplexity: DemandSchema,
    precision: DemandSchema,
    danger: DemandSchema,
    timePressure: DemandSchema,
  })
  .strict();

export const SemanticActionFrameSchema = z
  .object({
    kind: WorldActionKindSchema,
    actionType: SlugSchema,
    objective: TextSchema,
    actorId: UuidSchema,
    targetIds: z.array(UuidSchema).max(32),
    objectIds: z.array(UuidSchema).max(32),
    toolIds: z.array(UuidSchema).max(32),
    locationId: UuidSchema.optional(),
    quantity: z.number().positive().max(1_000_000).optional(),
    durationSeconds: z.number().int().positive().max(31_536_000).optional(),
    properties: SemanticActionPropertiesSchema,
    demands: SemanticActionDemandsSchema,
    assumptions: z.array(z.string().trim().min(1).max(500)).max(32),
    ambiguities: z.array(z.string().trim().min(1).max(500)).max(16),
  })
  .strict()
  .superRefine((frame, context) => {
    if (frame.properties.selfDirected && frame.targetIds.some((id) => id !== frame.actorId)) {
      context.addIssue({
        code: "custom",
        path: ["properties", "selfDirected"],
        message: "Self-directed actions cannot target another entity",
      });
    }
  });
export type SemanticActionFrame = z.infer<typeof SemanticActionFrameSchema>;

export const SemanticActionStepPayloadSchema = z
  .object({
    rawText: TextSchema,
    actionFrame: SemanticActionFrameSchema,
  })
  .passthrough();
export type SemanticActionStepPayload = z.infer<typeof SemanticActionStepPayloadSchema>;
