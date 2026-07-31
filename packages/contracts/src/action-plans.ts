import { z } from "zod";

const UuidSchema = z.string().uuid();
const SlugSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const TextSchema = z.string().trim().min(1).max(4_000);

export const PersistentPlanStatusSchema = z.enum([
  "planned",
  "running",
  "waiting_for_time",
  "waiting_for_world_event",
  "waiting_for_clarification",
  "blocked",
  "completed",
  "partially_completed",
  "failed",
  "cancelled",
  "superseded",
]);
export type PersistentPlanStatus = z.infer<typeof PersistentPlanStatusSchema>;

export const PersistentPlanStepStatusSchema = z.enum([
  "pending",
  "ready",
  "running",
  "waiting",
  "completed",
  "failed",
  "cancelled",
  "superseded",
]);

export const PersistentPlanDependencyTypeSchema = z.enum([
  "after_step_completed",
  "after_step_succeeded",
  "after_arrival",
  "after_entity_present",
  "after_item_acquired",
  "after_time",
  "after_event",
  "after_clarification",
  "after_access_granted",
]);

export const PersistentPlanStepProposalSchema = z
  .object({
    order: z.number().int().positive().max(64),
    kind: SlugSchema,
    description: TextSchema,
    intentPayload: z.record(z.string(), z.unknown()),
    referencedEntities: z
      .array(
        z
          .object({
            entityId: UuidSchema,
            role: z.enum([
              "actor",
              "target",
              "location",
              "method",
              "resource",
              "companion",
              "vehicle",
              "container",
              "other",
            ]),
            referenceText: z.string().trim().min(1).max(300).optional(),
            expectedVersion: z.number().int().nonnegative().optional(),
          })
          .strict(),
      )
      .max(32),
  })
  .strict();

export const PersistentPlanDependencyProposalSchema = z
  .object({
    stepOrder: z.number().int().positive().max(64),
    dependsOnStepOrder: z.number().int().positive().max(64).optional(),
    dependencyType: PersistentPlanDependencyTypeSchema,
    parameters: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

export const PersistentActionPlanProposalSchema = z
  .object({
    originalCommand: TextSchema,
    exclusivePhysical: z.boolean().default(true),
    steps: z.array(PersistentPlanStepProposalSchema).min(1).max(64),
    dependencies: z.array(PersistentPlanDependencyProposalSchema).max(128),
  })
  .strict()
  .superRefine((plan, context) => {
    plan.steps.forEach((step, index) => {
      if (step.order !== index + 1) {
        context.addIssue({
          code: "custom",
          path: ["steps", index, "order"],
          message: "Plan steps must be consecutive from one",
        });
      }
    });
    const maxOrder = plan.steps.length;
    plan.dependencies.forEach((dependency, index) => {
      if (dependency.stepOrder > maxOrder) {
        context.addIssue({
          code: "custom",
          path: ["dependencies", index, "stepOrder"],
          message: "Dependency references an unavailable step",
        });
      }
      if (
        dependency.dependsOnStepOrder !== undefined &&
        (dependency.dependsOnStepOrder >= dependency.stepOrder ||
          dependency.dependsOnStepOrder > maxOrder)
      ) {
        context.addIssue({
          code: "custom",
          path: ["dependencies", index, "dependsOnStepOrder"],
          message: "Step dependencies must reference an earlier step",
        });
      }
    });
  });
export type PersistentActionPlanProposal = z.infer<typeof PersistentActionPlanProposalSchema>;

export const PersistentActionPlanSchema = z
  .object({
    planId: UuidSchema,
    actorId: UuidSchema,
    status: PersistentPlanStatusSchema,
    planVersion: z.number().int().nonnegative(),
    activeStepId: UuidSchema.nullable(),
    exclusivePhysical: z.boolean(),
    steps: z.array(
      z
        .object({
          stepId: UuidSchema,
          order: z.number().int().positive(),
          kind: SlugSchema,
          description: TextSchema,
          status: PersistentPlanStepStatusSchema,
          idempotencyKey: z.string().trim().min(1).max(240),
          waitingReason: z.string().nullable(),
          outcomeGrade: z.string().nullable(),
        })
        .strict(),
    ),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type PersistentActionPlan = z.infer<typeof PersistentActionPlanSchema>;
