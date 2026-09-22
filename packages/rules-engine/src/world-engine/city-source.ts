import { featureMatchesFamily, type CategoryFamily, type EngineIntent } from "@nocturne/contracts";
import type { SourcePort, WorldCandidate } from "./ports.js";

export type CitySourceFeature = {
  sourceKey: string;
  name: string;
  lon: number;
  lat: number;
  properties: Record<string, unknown>;
};

export function walkingBbox(lon: number, lat: number, radiusMeters = 800) {
  const latDelta = radiusMeters / 111_320;
  const lonDelta = radiusMeters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return {
    minLongitude: lon - lonDelta,
    minLatitude: lat - latDelta,
    maxLongitude: lon + lonDelta,
    maxLatitude: lat + latDelta,
  };
}

export function haversineMeters(lon1: number, lat1: number, lon2: number, lat2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earth = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function pickNearestFeature(
  features: readonly CitySourceFeature[],
  input: { family: CategoryFamily; lon: number; lat: number },
): WorldCandidate | null {
  const matches = features
    .filter((feature) => featureMatchesFamily(feature.properties, input.family))
    .map((feature) => ({
      feature,
      distanceMeters: haversineMeters(input.lon, input.lat, feature.lon, feature.lat),
    }))
    .sort((left, right) => left.distanceMeters - right.distanceMeters);
  const winner = matches[0];
  if (!winner) return null;
  return {
    sourceKey: winner.feature.sourceKey,
    family: input.family,
    name: winner.feature.name,
    distanceMeters: Math.round(winner.distanceMeters),
    lon: winner.feature.lon,
    lat: winner.feature.lat,
    known: false,
    playable: false,
  };
}

export function createFeatureSourcePort(features: readonly CitySourceFeature[]): SourcePort {
  return {
    async queryNearest(input: {
      worldId: string;
      family: CategoryFamily;
      lon: number;
      lat: number;
      selector: EngineIntent["selector"];
    }) {
      return pickNearestFeature(features, input);
    },
  };
}
