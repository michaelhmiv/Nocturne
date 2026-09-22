import type { CitySourceFeature } from "./city-source.js";

/** Bounded Union Square stand-in extract. Replace with a real .osm.pbf import. */
export const OSM_MANHATTAN_FIXTURE: readonly CitySourceFeature[] = [
  {
    sourceKey: "osm:way:starter-building",
    name: "East 14th walk-up",
    lon: -73.99,
    lat: 40.735,
    properties: { building: "apartments" },
  },
  {
    sourceKey: "osm:node:14th-convenience",
    name: "14th Street Convenience",
    lon: -73.9892,
    lat: 40.7354,
    properties: { shop: "convenience", name: "14th Street Convenience" },
  },
  {
    sourceKey: "osm:node:uptown-supermarket",
    name: "Uptown Market",
    lon: -73.96,
    lat: 40.8,
    properties: { shop: "supermarket" },
  },
  {
    sourceKey: "osm:node:midtown-fuel",
    name: "Third Avenue Fuel",
    lon: -73.9885,
    lat: 40.736,
    properties: { amenity: "fuel" },
  },
  {
    sourceKey: "osm:node:14th-garage",
    name: "14th Street Auto",
    lon: -73.991,
    lat: 40.7345,
    properties: { shop: "car_repair" },
  },
  {
    sourceKey: "osm:node:9th-precinct",
    name: "9th Precinct",
    lon: -73.983,
    lat: 40.726,
    properties: { amenity: "police" },
  },
  {
    sourceKey: "osm:node:beth-israel",
    name: "Mount Sinai Beth Israel",
    lon: -73.982,
    lat: 40.733,
    properties: { amenity: "hospital" },
  },
];

export const OSM_STARTER_POINT = {
  sourceKey: "osm:way:starter-building",
  lon: -73.99,
  lat: 40.735,
} as const;
