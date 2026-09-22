import { describe, expect, it } from "vitest";
import {
  categoryTravelFrame,
  isCategoryTravelCommand,
  missingCityDestinationPrompt,
} from "./category-travel.js";

describe("category travel command gate", () => {
  it("treats nearest-grocery paraphrases as specified travel, not clarification bait", () => {
    expect(isCategoryTravelCommand("go to the nearest grocery store")).toBe(true);
    expect(isCategoryTravelCommand("walk to the closest bodega")).toBe(true);
    expect(categoryTravelFrame("go to the nearest grocery store")).toMatchObject({
      primitive: "travel",
      category: "place.retail.food",
      selector: "nearest",
    });
  });

  it("leaves unspecified deixis alone", () => {
    expect(isCategoryTravelCommand("go there")).toBe(false);
    expect(isCategoryTravelCommand("eat the sandwich")).toBe(false);
  });

  it("does not steal transfer commands that mention a mechanic", () => {
    expect(
      isCategoryTravelCommand("Give the Certification Wrench to the Certification Mechanic."),
    ).toBe(false);
    expect(isCategoryTravelCommand("hand the wrench to the mechanic")).toBe(false);
  });

  it("fails closed with a city-source message instead of asking which grocery", () => {
    const frame = categoryTravelFrame("go to the nearest grocery store");
    expect(missingCityDestinationPrompt(frame!)).toMatch(/loaded city source/);
    expect(missingCityDestinationPrompt(frame!)).not.toMatch(/which/i);
  });
});
