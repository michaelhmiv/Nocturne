import { familyFromProperties } from "@nocturne/contracts";

export type PublicPlaceRow = {
  dataset_key: string;
  provider_feature_id: string;
  name: string | null;
  properties: Record<string, unknown>;
  centroid_longitude: number;
  centroid_latitude: number;
};

export function validWorldPoint(value: unknown): { longitude: number; latitude: number } | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Record<string, unknown>;
  const longitude = state.lon;
  const latitude = state.lat;
  return typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90
    ? { longitude, latitude }
    : null;
}

export function geodesicDistanceMeters(
  a: { longitude: number; latitude: number },
  b: { longitude: number; latitude: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const v =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 12_742_000 * Math.asin(Math.min(1, Math.sqrt(v)));
}

/** Public source geography may be shown only after the player's actual point is grounded. */
export function projectDiscoverablePlaces(
  point: { longitude: number; latitude: number } | null,
  rows: PublicPlaceRow[],
  radiusMeters = 1600,
  limit = 16,
) {
  if (!point) return [];
  return rows
    .flatMap((row) => {
      const family = familyFromProperties(row.properties);
      const name = row.name?.trim();
      const sourceKey = `${row.dataset_key}:${row.provider_feature_id}`;
      const target = { longitude: row.centroid_longitude, latitude: row.centroid_latitude };
      if (
        !family ||
        !name ||
        name.length > 240 ||
        sourceKey.length > 160 ||
        !Number.isFinite(target.longitude) ||
        !Number.isFinite(target.latitude)
      )
        return [];
      const distanceMeters = Math.round(geodesicDistanceMeters(point, target));
      if (distanceMeters > radiusMeters) return [];
      return [{ sourceKey, name, family, distanceMeters, ...target }];
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.sourceKey.localeCompare(b.sourceKey))
    .slice(0, Math.min(16, limit));
}
