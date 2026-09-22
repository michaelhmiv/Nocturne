import { describe, expect, it } from "vitest";
import { pickNearestFeature } from "./city-source.js";
import { OSM_MANHATTAN_FIXTURE, OSM_STARTER_POINT } from "./osm-manhattan-fixture.js";

describe("OSM Manhattan fixture extract", () => {
  it("keeps grocery, fuel, garage, and precinct as distinct OSM classes", () => {
    expect(
      pickNearestFeature(OSM_MANHATTAN_FIXTURE, {
        family: "place.retail.food",
        ...OSM_STARTER_POINT,
      })?.sourceKey,
    ).toBe("osm:node:14th-convenience");
    expect(
      pickNearestFeature(OSM_MANHATTAN_FIXTURE, {
        family: "place.service.fuel",
        ...OSM_STARTER_POINT,
      })?.sourceKey,
    ).toBe("osm:node:midtown-fuel");
    expect(
      pickNearestFeature(OSM_MANHATTAN_FIXTURE, {
        family: "place.service.garage",
        ...OSM_STARTER_POINT,
      })?.sourceKey,
    ).toBe("osm:node:14th-garage");
    expect(
      pickNearestFeature(OSM_MANHATTAN_FIXTURE, {
        family: "place.civic.precinct",
        ...OSM_STARTER_POINT,
      })?.sourceKey,
    ).toBe("osm:node:9th-precinct");
  });

  it("resolves pharmacy, laundry, restaurant, bank, and subway as distinct classes", () => {
    expect(
      pickNearestFeature(OSM_MANHATTAN_FIXTURE, {
        family: "place.retail.pharmacy",
        ...OSM_STARTER_POINT,
      })?.sourceKey,
    ).toBe("osm:node:14th-pharmacy");
    expect(
      pickNearestFeature(OSM_MANHATTAN_FIXTURE, {
        family: "place.service.laundry",
        ...OSM_STARTER_POINT,
      })?.sourceKey,
    ).toBe("osm:node:union-laundry");
    expect(
      pickNearestFeature(OSM_MANHATTAN_FIXTURE, {
        family: "place.service.restaurant",
        ...OSM_STARTER_POINT,
      })?.sourceKey,
    ).toBe("osm:node:14th-diner");
    expect(
      pickNearestFeature(OSM_MANHATTAN_FIXTURE, {
        family: "place.service.bank",
        ...OSM_STARTER_POINT,
      })?.sourceKey,
    ).toBe("osm:node:chase-union");
    expect(
      pickNearestFeature(OSM_MANHATTAN_FIXTURE, {
        family: "place.transit",
        ...OSM_STARTER_POINT,
      })?.sourceKey,
    ).toBe("osm:node:union-subway");
  });
});
