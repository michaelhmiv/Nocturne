import { z } from "zod";
import { UniversalWorldOperationSchema } from "./world-operations.js";

const TextSchema = z.string().trim().min(1).max(4_000);
const FactIdSchema = z.string().trim().min(1).max(200);
const EntityIdSchema = z.string().uuid();

export const EstimatePrecisionSchema = z.enum([
  "qualitative",
  "bounded_range",
  "point_estimate",
]);
export type EstimatePrecision = z.infer<typeof EstimatePrecisionSchema>;

export const QualitativeMagnitudeSchema = z.enum([
  "none",
  "isolated",
  "minority",
  "several",
  "substantial_portion",
  "majority",
  "nearly_all",
  "all",
]);
export type QualitativeMagnitude = z.infer<typeof QualitativeMagnitudeSchema>;

export const GroundedEstimateSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    label: z.string().trim().min(1).max(160),
    unit: z.string().trim().min(1).max(80).optional(),
    precision: EstimatePrecisionSchema,
    qualitativeMagnitude: QualitativeMagnitudeSchema.optional(),
    minimum: z.number().finite().optional(),
    maximum: z.number().finite().optional(),
    point: z.number().finite().optional(),
    confidence: z.number().min(0).max(1),
    rationale: TextSchema,
  })
  .strict()
  .superRefine((estimate, context) => {
    if (estimate.precision === "qualitative" && !estimate.qualitativeMagnitude) {
      context.addIssue({
        code: "custom",
        path: ["qualitativeMagnitude"],
        message: "Qualitative estimates require a qualitative magnitude.",
      });
    }
    if (estimate.precision === "bounded_range") {
      if (estimate.minimum === undefined || estimate.maximum === undefined) {
        context.addIssue({
          code: "custom",
          path: ["minimum"],
          message: "Bounded estimates require minimum and maximum values.",
        });
      } else if (estimate.minimum > estimate.maximum) {
        context.addIssue({
          code: "custom",
          path: ["maximum"],
          message: "Estimate maximum must be greater than or equal to minimum.",
        });
      }
    }
    if (estimate.precision === "point_estimate" && estimate.point === undefined) {
      context.addIssue({
        code: "custom",
        path: ["point"],
        message: "Point estimates require a point value.",
      });
    }
    if (estimate.precision !== "point_estimate" && estimate.point !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["point"],
        message: "Only point estimates may contain a point value.",
      });
    }
  });
export type GroundedEstimate = z.infer<typeof GroundedEstimateSchema>;

export const GroundedAssumptionSchema = z
  .object({
    statement: TextSchema,
    basis: z.enum(["authoritative_fact", "reasonable_inference", "uncertain_estimate"]),
    confidence: z.number().min(0).max(1),
    factIds: z.array(FactIdSchema).max(32).default([]),
  })
  .strict();
export type GroundedAssumption = z.infer<typeof GroundedAssumptionSchema>;

export const GroundedWorldProposalSchema = z
  .object({
    summary: TextSchema,
    affectedEntityIds: z.array(EntityIdSchema).max(128),
    authoritativeFactIds: z.array(FactIdSchema).max(128),
    assumptions: z.array(GroundedAssumptionSchema).max(64),
    estimates: z.array(GroundedEstimateSchema).max(64),
    operations: z.array(UniversalWorldOperationSchema).max(256),
    unresolvedDetails: z.array(TextSchema).max(64).default([]),
    followUpNeeds: z.array(TextSchema).max(64).default([]),
    narrationConstraints: z.array(TextSchema).max(64).default([]),
  })
  .strict()
  .superRefine((proposal, context) => {
    const citedFacts = new Set(proposal.authoritativeFactIds);
    for (const assumption of proposal.assumptions) {
      for (const factId of assumption.factIds) {
        if (!citedFacts.has(factId)) {
          context.addIssue({
            code: "custom",
            path: ["assumptions"],
            message: `Assumption cites undeclared authoritative fact ${factId}.`,
          });
        }
      }
    }
    if (proposal.operations.length > 0 && proposal.affectedEntityIds.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["affectedEntityIds"],
        message: "Mutating proposals must identify affected entities.",
      });
    }
  });
export type GroundedWorldProposal = z.infer<typeof GroundedWorldProposalSchema>;
