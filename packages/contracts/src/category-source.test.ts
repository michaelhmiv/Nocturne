import { describe, expect, it } from "vitest";
import { featureMatchesFamily, sourceClassesFor } from "./category-source.js";

describe("category source classes", () => {
  it("speaks OSM shop tags for groceries instead of store names", () => {
    const matches = sourceClassesFor("place.retail.food");
    expect(matches.some((match) => match.key === "shop" && match.values.includes("convenience"))).toBe(
      true,
    );
    expect(featureMatchesFamily({ shop: "convenience" }, "place.retail.food")).toBe(true);
    expect(featureMatchesFamily({ shop: "supermarket" }, "place.retail.food")).toBe(true);
    expect(featureMatchesFamily({ amenity: "fuel" }, "place.retail.food")).toBe(false);
    expect(featureMatchesFamily({ amenity: "fuel" }, "place.service.fuel")).toBe(true);
  });
});
