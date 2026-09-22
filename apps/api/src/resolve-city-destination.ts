import { createHash } from "node:crypto";
import { categoryTravelFrame } from "./category-travel.js";
import {
  OSM_MANHATTAN_FIXTURE,
  pickNearestFeature,
  type CitySourceFeature,
} from "@nocturne/rules-engine";

export type ResolvedCityDestination = {
  entityId: string;
  sourceKey: string;
  name: string;
  family: string;
  distanceMeters: number;
};

export function stableEntityId(sourceKey: string) {
  const hex = createHash("sha1").update(`nocturne-osm:${sourceKey}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function resolveCityDestinationFromFeatures(input: {
  command: string;
  lon: number;
  lat: number;
  features?: readonly CitySourceFeature[];
}): ResolvedCityDestination | null {
  const frame = categoryTravelFrame(input.command);
  if (!frame?.category) return null;
  const nearest = pickNearestFeature(input.features ?? OSM_MANHATTAN_FIXTURE, {
    family: frame.category,
    lon: input.lon,
    lat: input.lat,
  });
  if (!nearest?.sourceKey || !nearest.name) return null;
  return {
    entityId: stableEntityId(nearest.sourceKey),
    sourceKey: nearest.sourceKey,
    name: nearest.name,
    family: nearest.family,
    distanceMeters: nearest.distanceMeters,
  };
}
