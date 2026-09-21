import { describe, expect, it } from "vitest";
import { selectOwnershipClaimTarget } from "../scripts/ci/certification-ownership-target.mjs";

describe("production certification ownership-claim fixture", () => {
  it("uses a real chair when one is present", () => {
    expect(
      selectOwnershipClaimTarget(
        [
          { entityId: "residence", name: "Unit 3" },
          { entityId: "chair-1", name: "Scuffed chair" },
        ],
        "residence",
      ),
    ).toEqual({ entityId: "chair-1", spokenName: "Scuffed chair" });
  });

  it("uses the actually created residence when starter housing is bare", () => {
    expect(selectOwnershipClaimTarget([], "residence-123")).toEqual({
      entityId: "residence-123",
      spokenName: "my current apartment",
    });
  });

  it("does not invent an entity if both fixture and residence are unavailable", () => {
    expect(selectOwnershipClaimTarget([{ name: "Chair" }], null)).toBeNull();
    expect(selectOwnershipClaimTarget([], "")).toBeNull();
  });
});
