import { describe, expect, it } from "vitest";
import { isCityTakeCommand, matchCityTake } from "./category-take.js";
import { isCategoryTravelCommand } from "./category-travel.js";

describe("city take command gate", () => {
  it("treats grab wrench from mechanic as take, not travel or Jev bait", () => {
    expect(isCityTakeCommand("Grab wrench from mechanic")).toBe(true);
    expect(isCategoryTravelCommand("Grab wrench from mechanic")).toBe(false);
    expect(matchCityTake("Grab wrench from mechanic")).toMatchObject({
      placeFamily: "place.service.garage",
      slot: { sku: "wrench" },
    });
  });

  it("leaves give and look-around alone", () => {
    expect(isCityTakeCommand("Give the Certification Wrench to the Certification Mechanic.")).toBe(
      false,
    );
    expect(isCityTakeCommand("look around")).toBe(false);
    expect(isCityTakeCommand("take me to the garage")).toBe(false);
  });
});
