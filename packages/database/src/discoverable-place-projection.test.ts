import { describe, expect, it } from "vitest";
import {
  geodesicDistanceMeters,
  projectDiscoverablePlaces,
  validWorldPoint,
} from "./discoverable-place-projection.js";

const origin = { longitude: -73.99, latitude: 40.735 };
const food = {
  dataset_key: "osm",
  provider_feature_id: "node:near-grocery",
  name: "Near Grocery",
  centroid_longitude: -73.989,
  centroid_latitude: 40.735,
  properties: { shop: "convenience" },
};
const far = {
  ...food,
  provider_feature_id: "node:far-grocery",
  name: "Far Grocery",
  centroid_longitude: -73.96,
  centroid_latitude: 40.8,
};

describe("player-scoped geography projection", () => {
  it("does not assign a starter coordinate to a character whose location is unknown", () => {
    expect(validWorldPoint({})).toBeNull();
    expect(validWorldPoint({ lon: "-73.99", lat: "40.735" })).toBeNull();
    expect(validWorldPoint({ lon: 1000, lat: 40 })).toBeNull();
    expect(projectDiscoverablePlaces(null, [food])).toEqual([]);
  });
  it("sorts genuine nearby POIs and excludes far or unclassified entities", () => {
    expect(validWorldPoint({ lon: -73.99, lat: 40.735 })).toEqual(origin);
    expect(
      projectDiscoverablePlaces(origin, [
        far,
        { ...food, provider_feature_id: "node:private", properties: {} },
        food,
      ]),
    ).toEqual([
      expect.objectContaining({
        sourceKey: "osm:node:near-grocery",
        name: "Near Grocery",
        family: "place.retail.food",
        longitude: -73.989,
        latitude: 40.735,
      }),
    ]);
    expect(geodesicDistanceMeters(origin, origin)).toBe(0);
  });
  it("changes neighborhood evidence when the actor moves", () => {
    expect(projectDiscoverablePlaces({ longitude: -73.96, latitude: 40.8 }, [food, far])).toEqual([
      expect.objectContaining({ sourceKey: "osm:node:far-grocery" }),
    ]);
  });
});
