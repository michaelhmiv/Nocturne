import { describe, expect, it } from "vitest";
import { WorldResourceKeySchema, worldResourceLimits } from "./resource.js";

describe("world resource ontology", () => {
  it("accepts explicit system resources", () => {
    expect(WorldResourceKeySchema.parse("heat")).toBe("heat");
    expect(WorldResourceKeySchema.parse("ammunition")).toBe("ammunition");
    expect(worldResourceLimits("durability")).toEqual({ minimum: 0, maximum: 100 });
  });

  it("rejects vague model-invented resources", () => {
    expect(WorldResourceKeySchema.safeParse("power").success).toBe(false);
    expect(WorldResourceKeySchema.safeParse("mystic_energy").success).toBe(false);
    expect(WorldResourceKeySchema.safeParse("cash").success).toBe(false);
  });
});
