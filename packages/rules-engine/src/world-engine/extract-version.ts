export const OSM_EXTRACT_ID = "osm:nyc-manhattan-union-square-starter";
export const OSM_EXTRACT_VERSION = "2026-09-22.1";

export function extractProvenance() {
  return {
    extractId: OSM_EXTRACT_ID,
    extractVersion: OSM_EXTRACT_VERSION,
    license: "ODbL",
  };
}
