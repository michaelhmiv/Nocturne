import { describe, expect, it } from "vitest";
import { EffectiveLocationSchema, TravelCohortSchema } from "./relationships.js";

const leader = "10000000-0000-4000-8000-000000000001";
const dog = "10000000-0000-4000-8000-000000000002";
const home = "10000000-0000-4000-8000-000000000003";

describe("persistent physical relationships", () => {
  it("represents nested effective location without duplicating physical state", () => {
    const location = EffectiveLocationSchema.parse({
      entityId: dog,
      immediateLocationId: home,
      effectiveLocationId: home,
      containmentChain: [dog, home],
      derivedFromRelationTypes: ["contained_in"],
    });
    expect(location.containmentChain).toEqual([dog, home]);
  });

  it("requires exactly one travel leader and unique members", () => {
    const cohort = TravelCohortSchema.parse({
      cohortId: "20000000-0000-4000-8000-000000000001",
      leaderId: leader,
      destinationId: home,
      status: "assembled",
      members: [
        {
          entityId: leader,
          role: "leader",
          required: true,
          expectedVersion: 1,
          expectedLocationId: null,
          validation: {},
        },
        {
          entityId: dog,
          role: "following",
          required: false,
          expectedVersion: 3,
          expectedLocationId: null,
          validation: { relation: "following" },
        },
      ],
    });
    expect(cohort.members[1]?.role).toBe("following");
  });

  it("rejects duplicate cohort members", () => {
    expect(() =>
      TravelCohortSchema.parse({
        cohortId: "20000000-0000-4000-8000-000000000001",
        leaderId: leader,
        destinationId: home,
        status: "assembled",
        members: [
          {
            entityId: leader,
            role: "leader",
            required: true,
            expectedVersion: 1,
            expectedLocationId: null,
            validation: {},
          },
          {
            entityId: leader,
            role: "passenger",
            required: true,
            expectedVersion: 1,
            expectedLocationId: null,
            validation: {},
          },
        ],
      }),
    ).toThrow(/members must be unique/i);
  });
});
