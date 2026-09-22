import { compileCityScene, OSM_MANHATTAN_FIXTURE, OSM_STARTER_POINT } from "@nocturne/rules-engine";
import type { createDatabase, WorldScope } from "@nocturne/database";

export async function compileLiveCityScene(input: {
  database?: ReturnType<typeof createDatabase>;
  scope?: Pick<WorldScope, "worldId" | "shardId">;
  locationId?: string | null;
}) {
  let here: { name?: string | null; family?: string | null; sourceKey?: string | null } | null =
    null;
  if (input.database && input.scope && input.locationId) {
    const rows = await input.database.client<
      { name: string | null; family: string | null; source_key: string | null }[]
    >`
      SELECT COALESCE(instance.state->>'name', definition.name) AS name,
             instance.state->>'family' AS family,
             instance.state->>'sourceKey' AS source_key
      FROM game.entity_instances instance
      JOIN game.entity_definitions definition
        ON definition.definition_id = instance.definition_id
      WHERE instance.world_id = ${input.scope.worldId}
        AND instance.shard_id = ${input.scope.shardId}
        AND instance.instance_id = ${input.locationId}
      LIMIT 1
    `;
    if (rows[0]) {
      here = {
        name: rows[0].name,
        family: rows[0].family,
        sourceKey: rows[0].source_key,
      };
    }
  }
  return compileCityScene({
    lon: OSM_STARTER_POINT.lon,
    lat: OSM_STARTER_POINT.lat,
    here,
    features: OSM_MANHATTAN_FIXTURE,
  });
}
