import type { PersistentSceneEntity } from "../../contracts/src/persistent-scene.js";

/** A remembered person or item is not a live GPS tracker. */
export function playerVisibleLocation(input: {
  presence: PersistentSceneEntity["presence"];
  locationId: string | null;
  locationName: string | null;
}): { locationId: string | null; locationName: string | null } {
  return input.presence === "known_elsewhere"
    ? { locationId: null, locationName: null }
    : { locationId: input.locationId, locationName: input.locationName };
}
