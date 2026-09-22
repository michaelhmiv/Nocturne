import { describe, expect, it } from "vitest";
import { OSM_STARTER_POINT } from "@nocturne/rules-engine";
import { resolveCityDestinationFromFeatures, stableEntityId } from "./resolve-city-destination.js";

describe("OSM city destination resolver", () => {
  it("sends nearest grocery to the close convenience shop, not uptown", () => {
    const resolved = resolveCityDestinationFromFeatures({
      command: "go to the nearest grocery store",
      lon: OSM_STARTER_POINT.lon,
      lat: OSM_STARTER_POINT.lat,
    });
    expect(resolved).toMatchObject({
      sourceKey: "osm:node:14th-convenience",
      name: "14th Street Convenience",
      family: "place.retail.food",
    });
    expect(resolved?.entityId).toBe(stableEntityId("osm:node:14th-convenience"));
    expect(resolved?.distanceMeters).toBeLessThan(200);
    expect(resolved?.lon).toBe(-73.9892);
    expect(resolved?.lat).toBe(40.7354);
  });

  it("does not treat a gas station as a grocery", () => {
    const resolved = resolveCityDestinationFromFeatures({
      command: "go to the nearest grocery store",
      lon: OSM_STARTER_POINT.lon,
      lat: OSM_STARTER_POINT.lat,
      features: [
        {
          sourceKey: "osm:node:midtown-fuel",
          name: "Third Avenue Fuel",
          lon: -73.9885,
          lat: 40.736,
          properties: { amenity: "fuel" },
        },
      ],
    });
    expect(resolved).toBeNull();
  });

  it("resolves drive-to-garage against car_repair", () => {
    const resolved = resolveCityDestinationFromFeatures({
      command: "drive to the garage",
      lon: OSM_STARTER_POINT.lon,
      lat: OSM_STARTER_POINT.lat,
    });
    expect(resolved?.sourceKey).toBe("osm:node:14th-garage");
    expect(resolved?.family).toBe("place.service.garage");
  });

  it("is deterministic across calls", () => {
    const first = resolveCityDestinationFromFeatures({
      command: "walk to the closest bodega",
      lon: OSM_STARTER_POINT.lon,
      lat: OSM_STARTER_POINT.lat,
    });
    const second = resolveCityDestinationFromFeatures({
      command: "walk to the closest bodega",
      lon: OSM_STARTER_POINT.lon,
      lat: OSM_STARTER_POINT.lat,
    });
    expect(first?.entityId).toBe(second?.entityId);
    expect(first?.sourceKey).toBe("osm:node:14th-convenience");
  });
});
