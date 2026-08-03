import { describe, expect, it } from "vitest";
import { GroundedEstimateSchema, GroundedWorldProposalSchema } from "./grounded-estimate.js";

const entityId = "10000000-0000-4000-8000-000000000001";

describe("grounded LLM estimates", () => {
  it("accepts qualitative damage without false precision", () => {
    expect(
      GroundedEstimateSchema.parse({
        key: "street_facing_window_damage",
        label: "Street-facing windows broken",
        precision: "qualitative",
        qualitativeMagnitude: "majority",
        confidence: 0.72,
        rationale:
          "The blast reached most of the exposed facade, but individual panes are not materialized.",
      }),
    ).toMatchObject({ qualitativeMagnitude: "majority" });
  });

  it("requires complete and ordered bounded ranges", () => {
    expect(
      GroundedEstimateSchema.safeParse({
        key: "repair_cost",
        label: "Repair cost",
        unit: "usd",
        precision: "bounded_range",
        minimum: 45_000,
        confidence: 0.6,
        rationale: "Known footprint and facade damage support only a range.",
      }).success,
    ).toBe(false);

    expect(
      GroundedEstimateSchema.safeParse({
        key: "repair_cost",
        label: "Repair cost",
        unit: "usd",
        precision: "bounded_range",
        minimum: 90_000,
        maximum: 45_000,
        confidence: 0.6,
        rationale: "Invalid reversed range.",
      }).success,
    ).toBe(false);
  });

  it("rejects assumptions that cite undeclared facts", () => {
    expect(
      GroundedWorldProposalSchema.safeParse({
        summary: "Most exposed windows are broken and the facade needs inspection.",
        affectedEntityIds: [entityId],
        authoritativeFactIds: [],
        assumptions: [
          {
            statement: "The building was substantially occupied.",
            basis: "reasonable_inference",
            confidence: 0.55,
            factIds: ["fact:occupancy"],
          },
        ],
        estimates: [],
        operations: [],
      }).success,
    ).toBe(false);
  });

  it("requires affected entities for mutating proposals", () => {
    expect(
      GroundedWorldProposalSchema.safeParse({
        summary: "Apply aggregate facade damage.",
        affectedEntityIds: [],
        authoritativeFactIds: [],
        assumptions: [],
        estimates: [],
        operations: [
          {
            type: "set_state_value",
            entityRef: { kind: "existing", entityId },
            path: ["damage", "facade"],
            value: "majority_windows_broken",
            expectedVersion: 1,
            preconditionFactIds: [],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
