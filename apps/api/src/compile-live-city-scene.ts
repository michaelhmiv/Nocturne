import { compileCityScene, haversineMeters, OSM_MANHATTAN_FIXTURE } from "@nocturne/rules-engine";
import { validWorldPoint, type createDatabase, type WorldScope } from "@nocturne/database";

/**
 * This view can never silently substitute the starter neighborhood for
 * an actor whose location is unknown or belongs to another district.
 */
export async function compileLiveCityScene(input: {
  database?: ReturnType<typeof createDatabase>;
  scope?: Pick<WorldScope, "worldId" | "shardId">;
  locationId?: string | null;
}) {
  let here: { name?: string | null; family?: string | null; sourceKey?: string | null } | null =
    null;
  let point: { longitude: number; latitude: number } | null = null;
  if (input.database && input.scope && input.locationId) {
    const rows = await input.database.client<
      {
        name: string | null;
        state: Record<string, unknown>;
      }[]
    >`
      SELECT COALESCE(instance.state->>'name', definition.name) AS name,
             instance.state
      FROM game.entity_instances instance
      JOIN game.entity_definitions definition
        ON definition.definition_id = instance.definition_id
      WHERE instance.world_id = ${input.scope.worldId}
        AND instance.shard_id = ${input.scope.shardId}
        AND instance.instance_id = ${input.locationId}
      LIMIT 1
    `;
    if (rows[0]) {
      const state = rows[0].state;
      here = {
        name: rows[0].name,
        family: typeof state.family === "string" ? state.family : null,
        sourceKey: typeof state.sourceKey === "string" ? state.sourceKey : null,
      };
      point = validWorldPoint(state);
    }
  }
  if (!point) {
    const hereName = here?.name || "an unmapped location";
    return {
      hereName,
      nearby: [],
      facts: [
        `You are at ${hereName}.`,
        "Nearby street geography is not available for this location.",
      ],
    };
  }
  const features = OSM_MANHATTAN_FIXTURE.filter(
    (feature) => haversineMeters(point.longitude, point.latitude, feature.lon, feature.lat) <= 1600,
  );
  return compileCityScene({
    lon: point.longitude,
    lat: point.latitude,
    here,
    features,
  });
}
