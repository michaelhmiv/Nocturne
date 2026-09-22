import { describe, expect, it } from "vitest";
import { pickNearestFeature } from "./city-source.js";
import { OSM_MANHATTAN_FIXTURE, OSM_STARTER_POINT } from "./osm-manhattan-fixture.js";

describe("OSM Manhattan fixture extract", () => {
  it("keeps grocery, fuel, garage, and precinct as distinct OSM classes", () => {
    const grocery = pickNearestFeature(OSM_MANHATTAN_FIXTURE, {
      family: "place.retail.food",
      ...OSM_STARTER_POINT,
    });
    const fuel = pickNearestFeature(OSM_MANHATTAN_FIXTURE, {
      family: "place.service.fuel",
      ...OSM_STARTER_POINT,
    });
    const garage = pickNearestFeature(OSM_MANHATTAN_FIXTURE, {
      family: "place.service.garage",
      ...OSM_STARTER_POINT,
    });
    const precinct = pickNearestFeature(OSM_MANHATTAN_FIXTURE, {
      family: "place.civic.precinct",
      ...OSM_STARTER_POINT,
    });
    expect(grocery?.sourceKey).toBe("osm:node:14th-convenience");
    expect(fuel?.sourceKey).toBe("osm:node:midtown-fuel");
    expect(garage?.sourceKey).toBe("osm:node:14th-garage");
    expect(precinct?.sourceKey).toBe("osm:node:9th-precinct");
  });
});
