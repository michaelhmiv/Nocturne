import { z } from "zod";

const CoordinateSchema = z.tuple([
  z.number().finite().min(-180).max(180),
  z.number().finite().min(-90).max(90),
]);

export const GeoJsonGeometryTypeSchema = z.enum([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
]);
export type GeoJsonGeometryType = z.infer<typeof GeoJsonGeometryTypeSchema>;

export const SpatialFeatureKindSchema = z.enum([
  "parcel",
  "building",
  "road",
  "path",
  "district",
  "poi",
  "shoreline",
]);
export type SpatialFeatureKind = z.infer<typeof SpatialFeatureKindSchema>;

export const CanonicalSpatialTypeSchema = z.enum([
  "district",
  "parcel",
  "building",
  "street",
  "path",
  "poi",
  "shoreline",
]);
export type CanonicalSpatialType = z.infer<typeof CanonicalSpatialTypeSchema>;

export const SpatialProvenanceSchema = z.enum([
  "seeded",
  "template_instantiated",
  "ai_proposed",
  "player_created",
  "operator_authored",
  "derived",
]);
export type SpatialProvenance = z.infer<typeof SpatialProvenanceSchema>;

type Coordinate = [number, number];

type GeoJsonGeometry = {
  type: GeoJsonGeometryType;
  coordinates: unknown;
};

function coordinate(value: unknown): value is Coordinate {
  return CoordinateSchema.safeParse(value).success;
}

function coordinateList(value: unknown, minimum = 1): value is Coordinate[] {
  return Array.isArray(value) && value.length >= minimum && value.every(coordinate);
}

function lineList(value: unknown, minimumPoints = 2): value is Coordinate[][] {
  return Array.isArray(value) && value.length > 0 && value.every((line) => coordinateList(line, minimumPoints));
}

function polygonList(value: unknown): value is Coordinate[][] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((ring) => {
    if (!coordinateList(ring, 4)) return false;
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    return first[0] === last[0] && first[1] === last[1];
  });
}

function validCoordinates(type: GeoJsonGeometryType, value: unknown) {
  switch (type) {
    case "Point":
      return coordinate(value);
    case "MultiPoint":
      return coordinateList(value);
    case "LineString":
      return coordinateList(value, 2);
    case "MultiLineString":
      return lineList(value, 2);
    case "Polygon":
      return polygonList(value);
    case "MultiPolygon":
      return Array.isArray(value) && value.length > 0 && value.every(polygonList);
  }
}

export const GeoJsonGeometrySchema: z.ZodType<GeoJsonGeometry> = z
  .object({
    type: GeoJsonGeometryTypeSchema,
    coordinates: z.unknown(),
  })
  .strict()
  .superRefine((geometry, context) => {
    if (!validCoordinates(geometry.type, geometry.coordinates)) {
      context.addIssue({
        code: "custom",
        path: ["coordinates"],
        message: `Coordinates are invalid for ${geometry.type}.`,
      });
    }
  });

export type GeoJsonGeometryInput = z.infer<typeof GeoJsonGeometrySchema>;

function collectCoordinates(value: unknown, output: Coordinate[]) {
  if (coordinate(value)) {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectCoordinates(item, output);
  }
}

export type SpatialBounds = {
  minLongitude: number;
  minLatitude: number;
  maxLongitude: number;
  maxLatitude: number;
  centroidLongitude: number;
  centroidLatitude: number;
};

export function calculateSpatialBounds(geometry: GeoJsonGeometryInput): SpatialBounds {
  const parsed = GeoJsonGeometrySchema.parse(geometry);
  const coordinates: Coordinate[] = [];
  collectCoordinates(parsed.coordinates, coordinates);
  if (coordinates.length === 0) throw new Error("Geometry contains no coordinates.");

  let minLongitude = Number.POSITIVE_INFINITY;
  let minLatitude = Number.POSITIVE_INFINITY;
  let maxLongitude = Number.NEGATIVE_INFINITY;
  let maxLatitude = Number.NEGATIVE_INFINITY;
  let longitudeTotal = 0;
  let latitudeTotal = 0;
  for (const [longitude, latitude] of coordinates) {
    minLongitude = Math.min(minLongitude, longitude);
    minLatitude = Math.min(minLatitude, latitude);
    maxLongitude = Math.max(maxLongitude, longitude);
    maxLatitude = Math.max(maxLatitude, latitude);
    longitudeTotal += longitude;
    latitudeTotal += latitude;
  }

  return {
    minLongitude,
    minLatitude,
    maxLongitude,
    maxLatitude,
    centroidLongitude: longitudeTotal / coordinates.length,
    centroidLatitude: latitudeTotal / coordinates.length,
  };
}

export const SpatialBoundsSchema = z
  .object({
    minLongitude: z.number().finite().min(-180).max(180),
    minLatitude: z.number().finite().min(-90).max(90),
    maxLongitude: z.number().finite().min(-180).max(180),
    maxLatitude: z.number().finite().min(-90).max(90),
    centroidLongitude: z.number().finite().min(-180).max(180),
    centroidLatitude: z.number().finite().min(-90).max(90),
  })
  .strict()
  .superRefine((bounds, context) => {
    if (bounds.minLongitude > bounds.maxLongitude) {
      context.addIssue({ code: "custom", path: ["minLongitude"], message: "Longitude bounds are reversed." });
    }
    if (bounds.minLatitude > bounds.maxLatitude) {
      context.addIssue({ code: "custom", path: ["minLatitude"], message: "Latitude bounds are reversed." });
    }
    if (
      bounds.centroidLongitude < bounds.minLongitude ||
      bounds.centroidLongitude > bounds.maxLongitude ||
      bounds.centroidLatitude < bounds.minLatitude ||
      bounds.centroidLatitude > bounds.maxLatitude
    ) {
      context.addIssue({ code: "custom", path: ["centroidLongitude"], message: "Centroid must lie inside the bounds." });
    }
  });

export const GeospatialDatasetSchema = z
  .object({
    datasetKey: z.string().regex(/^[a-z0-9][a-z0-9_:-]{1,119}$/),
    provider: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(300),
    sourceUrl: z.string().url().max(2_000),
    licenseName: z.string().trim().min(1).max(300).optional(),
    attributionText: z.string().trim().min(1).max(1_000).optional(),
    sourceVersion: z.string().trim().min(1).max(160),
    sourceUpdatedAt: z.string().datetime().optional(),
    geometryCrs: z.string().trim().min(1).max(80).default("EPSG:4326"),
    featureKind: SpatialFeatureKindSchema,
    configuration: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type GeospatialDataset = z.infer<typeof GeospatialDatasetSchema>;

export const GeospatialSourceFeatureSchema = z
  .object({
    providerFeatureId: z.string().trim().min(1).max(300),
    featureKind: SpatialFeatureKindSchema,
    geometry: GeoJsonGeometrySchema,
    properties: z.record(z.string(), z.unknown()).default({}),
    sourceUpdatedAt: z.string().datetime().optional(),
  })
  .strict();
export type GeospatialSourceFeature = z.infer<typeof GeospatialSourceFeatureSchema>;

export const GeospatialImportRequestSchema = z
  .object({
    datasetKey: z.string().trim().min(1).max(120),
    sourceVersion: z.string().trim().min(1).max(160),
    requestParameters: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type GeospatialImportRequest = z.infer<typeof GeospatialImportRequestSchema>;

export const CanonicalSpatialEntityInputSchema = z
  .object({
    worldId: z.string().uuid(),
    shardId: z.string().uuid(),
    activationCellId: z.string().uuid().optional(),
    stableKey: z.string().regex(/^[a-z0-9][a-z0-9_:.-]{1,199}$/),
    spatialType: CanonicalSpatialTypeSchema,
    name: z.string().trim().min(1).max(300),
    parentSpatialEntityId: z.string().uuid().optional(),
    geometry: GeoJsonGeometrySchema,
    provenance: SpatialProvenanceSchema,
    state: z.record(z.string(), z.unknown()).default({}),
    sourceFeatureIds: z.array(z.string().uuid()).max(64).default([]),
    transformationVersion: z.string().trim().min(1).max(160),
    transformationMetadata: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();
export type CanonicalSpatialEntityInput = z.infer<typeof CanonicalSpatialEntityInputSchema>;

export const SpatialBoundingBoxQuerySchema = z
  .object({
    minLongitude: z.number().finite().min(-180).max(180),
    minLatitude: z.number().finite().min(-90).max(90),
    maxLongitude: z.number().finite().min(-180).max(180),
    maxLatitude: z.number().finite().min(-90).max(90),
    featureKinds: z.array(SpatialFeatureKindSchema).max(16).optional(),
    limit: z.number().int().positive().max(5_000).default(500),
  })
  .strict()
  .superRefine((query, context) => {
    if (query.minLongitude > query.maxLongitude || query.minLatitude > query.maxLatitude) {
      context.addIssue({ code: "custom", path: ["minLongitude"], message: "Bounding box is reversed." });
    }
  });
export type SpatialBoundingBoxQuery = z.infer<typeof SpatialBoundingBoxQuerySchema>;
