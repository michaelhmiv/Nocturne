import { z } from "zod";
import { WorldResourceKeySchema } from "./resource.js";
import { UniversalWorldOperationSchema } from "./world-operations.js";

const UuidSchema = z.string().uuid();
const TextSchema = z.string().trim().min(1).max(2_000);

export const LazySimulationRequestSchema = z
  .object({
    entityId: UuidSchema,
    definitionType: z.string().trim().min(1).max(100),
    definitionName: z.string().trim().min(1).max(240),
    lifecycleStatus: z.string().trim().min(1).max(80),
    condition: z.number().int().min(0).max(100),
    state: z.record(z.string(), z.unknown()),
    locationId: UuidSchema.nullable(),
    elapsedSeconds: z.number().int().nonnegative().max(604_800),
    policy: z
      .object({
        policyId: UuidSchema,
        policyVersion: z.string().trim().min(1).max(120),
        description: TextSchema,
        stateKeys: z.array(z.string().trim().min(1).max(100)).max(64),
        resourceKeys: z.array(WorldResourceKeySchema).max(32).default([]),
        allowedOperationTypes: z.array(z.string().trim().min(1).max(100)).max(32),
        constraints: z.array(z.string().trim().min(1).max(500)).max(64),
      })
      .strict(),
    relevantFacts: z.array(z.string().trim().min(1).max(1_000)).max(64),
    accessibleLocationIds: z.array(UuidSchema).max(64),
  })
  .strict();
export type LazySimulationRequest = z.infer<typeof LazySimulationRequestSchema>;

export const LazySimulationProposalSchema = z
  .object({
    decision: z.enum(["no_change", "mutate"]),
    summary: TextSchema,
    operations: z.array(UniversalWorldOperationSchema).max(16),
    assumptions: z.array(z.string().trim().min(1).max(500)).max(16),
    nextSimulationSeconds: z.number().int().min(60).max(604_800),
  })
  .strict()
  .superRefine((proposal, context) => {
    if ((proposal.decision === "no_change") !== (proposal.operations.length === 0)) {
      context.addIssue({
        code: "custom",
        path: ["operations"],
        message: "No-change simulation must have no operations; mutation must have at least one",
      });
    }
  });
export type LazySimulationProposal = z.infer<typeof LazySimulationProposalSchema>;

export const LazySimulationResultSchema = z
  .object({
    runId: UuidSchema,
    entityId: UuidSchema,
    status: z.enum(["committed", "no_change", "stale"]),
    eventId: UuidSchema.optional(),
    receiptId: UuidSchema.optional(),
    nextSimulationAt: z.string().datetime(),
  })
  .strict();
export type LazySimulationResult = z.infer<typeof LazySimulationResultSchema>;
