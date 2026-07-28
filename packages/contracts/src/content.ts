import { z } from "zod";

export const LifecycleStatusSchema = z.enum([
  "draft",
  "provisional",
  "approved",
  "deprecated",
  "restricted",
]);

export const TraitBindingSchema = z.object({
  name: z.string().min(1),
  type: z.enum([
    "descriptive",
    "mechanical",
    "source",
    "material",
    "behavior",
    "legal",
    "aesthetic",
  ]),
  parameters: z.record(z.string(), z.unknown()).default({}),
});

export const EffectBindingSchema = z.object({
  effectId: z.string().min(1),
  domainId: z.string().min(1).optional(),
  modeId: z.string().min(1).optional(),
  target: z.string().min(1),
  strength: z.number().int().min(0).max(10),
  range: z.string().min(1).optional(),
  scale: z.string().min(1).optional(),
  precision: z.number().int().min(0).max(10).optional(),
  duration: z.string().min(1).optional(),
  parameters: z.record(z.string(), z.unknown()).default({}),
});

export const RequirementSchema = z.object({
  phase: z.enum(["creation", "installation", "activation", "targeting", "upkeep"]),
  ruleId: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()).default({}),
  severity: z.enum(["hard", "conditional", "warning"]).default("hard"),
});

export const ResourceCostSchema = z.object({
  resource: z.string().min(1),
  amount: z.number().nonnegative(),
  timing: z.enum(["creation", "installation", "activation", "per_tick", "upkeep"]),
  parameters: z.record(z.string(), z.unknown()).default({}),
});

export const SignatureSchema = z.object({
  channel: z.string().min(1),
  strength: z.number().int().min(0).max(10),
  persistence: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).default({}),
});

export const ModeSchema = z.object({
  modeId: z.string().min(1),
  name: z.string().min(1),
  effects: z.array(EffectBindingSchema).min(1),
  requirements: z.array(RequirementSchema).default([]),
  costs: z.array(ResourceCostSchema).default([]),
  signatures: z.array(SignatureSchema).default([]),
});

export const AcquisitionPathSchema = z.object({
  type: z.enum([
    "immediate",
    "purchased",
    "trained",
    "built",
    "researched",
    "discovered",
    "inherited",
    "story_gated",
  ]),
  stages: z.number().int().positive().optional(),
  parameters: z.record(z.string(), z.unknown()).default({}),
});

export const RelationshipBindingSchema = z
  .object({
    relationType: z.string().min(1),
    targetDefinitionId: z.string().min(1).optional(),
    targetInstanceId: z.string().min(1).optional(),
    parameters: z.record(z.string(), z.unknown()).default({}),
  })
  .refine((relationship) => relationship.targetDefinitionId || relationship.targetInstanceId, {
    message: "A relationship requires a target definition or instance.",
  });

export const GeneratedDefinitionDraftSchema = z.object({
  definitionType: z.string().min(1),
  name: z.string().min(1),
  conceptSummary: z.string().min(1),
  playerFantasy: z.string().min(1),
  noveltyLevel: z.number().int().min(0).max(5),
  originSource: z.string().min(1),
  traits: z.array(TraitBindingSchema).default([]),
  effects: z.array(EffectBindingSchema).default([]),
  modes: z.array(ModeSchema).default([]),
  requirements: z.array(RequirementSchema).default([]),
  costs: z.array(ResourceCostSchema).default([]),
  limitations: z.array(z.string().min(1)).default([]),
  risks: z.array(z.string().min(1)).default([]),
  signatures: z.array(SignatureSchema).default([]),
  counters: z.array(z.string().min(1)).default([]),
  relationships: z.array(RelationshipBindingSchema).default([]),
  acquisitionPath: AcquisitionPathSchema,
  extensionPayload: z.record(z.string(), z.unknown()).default({}),
  status: LifecycleStatusSchema.default("provisional"),
});

export type GeneratedDefinitionDraft = z.infer<typeof GeneratedDefinitionDraftSchema>;
