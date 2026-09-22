import { describe, expect, it } from "vitest";
import { compileCityScene } from "./compile-city-scene.js";
import { OSM_STARTER_POINT } from "./osm-manhattan-fixture.js";

describe("compileCityScene", () => {
  it("lists named nearby OSM places without inventing a clerk", () => {
    const packet = compileCityScene({
      lon: OSM_STARTER_POINT.lon,
      lat: OSM_STARTER_POINT.lat,
      here: {
        name: "14th Street Convenience",
        family: "place.retail.food",
        sourceKey: "osm:node:14th-convenience",
      },
    });
    expect(packet.facts.some((fact) => fact.includes("14th Street Convenience"))).toBe(true);
    expect(packet.nearby.length).toBeGreaterThan(1);
    expect(packet.facts.join(" ")).not.toMatch(/clerk|suspicious man/i);
    expect(packet.nearby.some((place) => place.family !== "place.retail.food")).toBe(true);
  });
});
