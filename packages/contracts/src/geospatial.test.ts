import { describe, expect, it } from "vitest";
import {
  CanonicalSpatialEntityInputSchema,
  GeoJsonGeometrySchema,
  GeospatialSourceFeatureSchema,
  SpatialBoundingBoxQuerySchema,
  calculateSpatialBounds,
} from "./geospatial.js";

const parcelGeometry = {
  type: "Polygon" as const,
  coordinates: [
    [
      [-73.991, 40.72],
      [-73.99, 40.72],
      [-73.99, 40.721],
      [-73.991, 40.721],
      [-73.991, 40.72],
    ],
  ],
};

describe("geospatial contracts", () => {
  it("validates closed parcel polygons and derives bounded coordinates", () => {
    expect(GeoJsonGeometrySchema.parse(parcelGeometry)).toEqual(parcelGeometry);
    expect(calculateSpatialBounds(parcelGeometry)).toEqual({
      minLongitude: -73.991,
      minLatitude: 40.72,
      maxLongitude: -73.99,
      maxLatitude: 40.721,
      centroidLongitude: expect.closeTo(-73.9906),
      centroidLatitude: expect.closeTo(40.7204),
    });
  });

  it("rejects open polygon rings and invalid coordinate ranges", () => {
    expect(
      GeoJsonGeometrySchema.safeParse({
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
          ],
        ],
      }).success,
    ).toBe(false);
    expect(
      GeoJsonGeometrySchema.safeParse({ type: "Point", coordinates: [-181, 95] }).success,
    ).toBe(false);
  });

  it("accepts source features without copying real identity into canonical state", () => {
    const source = GeospatialSourceFeatureSchema.parse({
      providerFeatureId: "tax-lot-10001",
      featureKind: "parcel",
      geometry: parcelGeometry,
      properties: {
        boroughBlockLot: "1000010001",
        realOwnerName: "Source-only identity",
      },
    });
    const canonical = CanonicalSpatialEntityInputSchema.parse({
      worldId: "10000000-0000-4000-8000-000000000001",
      shardId: "10000000-0000-4000-8000-000000000002",
      stableKey: "parcel:foundry:0001",
      spatialType: "parcel",
      name: "Foundry Parcel 0001",
      geometry: source.geometry,
      provenance: "seeded",
      state: { developmentStatus: "existing" },
      sourceFeatureIds: ["10000000-0000-4000-8000-000000000003"],
      transformationVersion: "nyc-fictionalization-v1",
    });
    expect(canonical.state).not.toHaveProperty("realOwnerName");
    expect(canonical.name).toBe("Foundry Parcel 0001");
  });

  it("rejects reversed bounding-box queries", () => {
    expect(
      SpatialBoundingBoxQuerySchema.safeParse({
        minLongitude: -73.9,
        minLatitude: 40.8,
        maxLongitude: -74.1,
        maxLatitude: 40.7,
      }).success,
    ).toBe(false);
  });
});
