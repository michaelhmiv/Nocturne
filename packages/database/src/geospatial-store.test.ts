import { describe, expect, it } from "vitest";
import { geospatialSourceHash } from "./geospatial-store.js";

const geometry = {
  type: "Point" as const,
  coordinates: [-73.99, 40.72],
};

describe("geospatial source hashing", () => {
  it("is stable across property insertion order", () => {
    const first = geospatialSourceHash({
      providerFeatureId: "poi-1",
      featureKind: "poi",
      geometry,
      properties: { category: "restaurant", name: "Source restaurant", capacity: 40 },
    });
    const second = geospatialSourceHash({
      providerFeatureId: "poi-1",
      featureKind: "poi",
      geometry,
      properties: { capacity: 40, name: "Source restaurant", category: "restaurant" },
    });
    expect(first).toBe(second);
  });

  it("changes when authoritative source geometry or attributes change", () => {
    const original = geospatialSourceHash({
      providerFeatureId: "parcel-1",
      featureKind: "parcel",
      geometry,
      properties: { lotArea: 1000 },
    });
    const changed = geospatialSourceHash({
      providerFeatureId: "parcel-1",
      featureKind: "parcel",
      geometry: { type: "Point", coordinates: [-73.991, 40.72] },
      properties: { lotArea: 1200 },
    });
    expect(changed).not.toBe(original);
  });
});
