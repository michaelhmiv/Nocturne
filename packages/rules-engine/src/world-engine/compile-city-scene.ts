import { FAMILY_STOCK, familyFromProperties, type CategoryFamily } from "@nocturne/contracts";
import { haversineMeters, type CitySourceFeature } from "./city-source.js";
import { OSM_MANHATTAN_FIXTURE } from "./osm-manhattan-fixture.js";

export type CityScenePlace = {
  sourceKey: string;
  name: string;
  family: CategoryFamily;
  distanceMeters: number;
};

export type CityScenePacket = {
  hereName: string;
  hereFamily?: CategoryFamily;
  nearby: CityScenePlace[];
  facts: string[];
};

function familyLabel(family: CategoryFamily) {
  return family.replace(/^place\.(retail|service|civic)\./, "").replaceAll(".", " ");
}

export function compileCityScene(input: {
  lon: number;
  lat: number;
  here?: { name?: string | null; family?: string | null; sourceKey?: string | null } | null;
  features?: readonly CitySourceFeature[];
  limit?: number;
}): CityScenePacket {
  const features = input.features ?? OSM_MANHATTAN_FIXTURE;
  const nearby = features
    .map((feature) => {
      const family = familyFromProperties(feature.properties);
      if (!family) return null;
      return {
        sourceKey: feature.sourceKey,
        name: feature.name,
        family,
        distanceMeters: Math.round(haversineMeters(input.lon, input.lat, feature.lon, feature.lat)),
      };
    })
    .filter((place): place is CityScenePlace => Boolean(place))
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .slice(0, input.limit ?? 8);

  const hereName = input.here?.name?.trim() || nearby[0]?.name || "the street";
  const hereFamily = (input.here?.family as CategoryFamily | undefined) || nearby[0]?.family;
  const facts: string[] = [];
  if (input.here?.name) {
    facts.push(
      `You are at ${input.here.name}${hereFamily ? ` (${familyLabel(hereFamily)})` : ""}.`,
    );
  } else {
    facts.push(`You are outdoors near ${hereName}.`);
  }

  const others = nearby.filter((place) => place.sourceKey !== input.here?.sourceKey).slice(0, 6);
  if (others.length > 0) {
    facts.push(
      `Nearby: ${others
        .map((place) => `${place.name} (${familyLabel(place.family)}, ${place.distanceMeters}m)`)
        .join("; ")}.`,
    );
  } else {
    facts.push("No other mapped storefronts are in range of the loaded city extract.");
  }

  if (hereFamily && FAMILY_STOCK[hereFamily]) {
    facts.push("The counter and stock exist only after you go inside; the storefront is visible.");
  }

  return { hereName, hereFamily, nearby, facts };
}
