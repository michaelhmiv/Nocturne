import { serializeJson, type createDatabase, type WorldScope } from "@nocturne/database";
import type { ResolvedCityDestination } from "./resolve-city-destination.js";

const PLACE_DEFINITION_ID = "osm-place";

export async function ensureCityDestination(input: {
  database: ReturnType<typeof createDatabase>;
  scope: Pick<WorldScope, "worldId" | "shardId">;
  destination: ResolvedCityDestination;
  actorLocationId?: string | null;
}) {
  const sql = input.database.client;
  await sql`
    INSERT INTO game.entity_definitions (
      definition_id, definition_type, name, concept_summary, origin_source, lifecycle_status
    ) VALUES (
      ${PLACE_DEFINITION_ID},
      'location',
      'OpenStreetMap place',
      'A playable city place bound from the OSM extract.',
      'osm_source',
      'approved'
    )
    ON CONFLICT (definition_id) DO NOTHING
  `;
  await sql`
    INSERT INTO game.entity_instances (
      instance_id, world_id, shard_id, definition_id, condition, state,
      version, lifecycle_status, provenance
    ) VALUES (
      ${input.destination.entityId},
      ${input.scope.worldId},
      ${input.scope.shardId},
      ${PLACE_DEFINITION_ID},
      100,
      ${serializeJson({
        sourceKey: input.destination.sourceKey,
        name: input.destination.name,
        family: input.destination.family,
      })}::jsonb,
      0,
      'active',
      ${serializeJson({
        sourceType: "seed",
        sourceId: input.destination.sourceKey,
      })}::jsonb
    )
    ON CONFLICT (instance_id) DO UPDATE
    SET world_id = EXCLUDED.world_id,
        shard_id = EXCLUDED.shard_id,
        updated_at = now()
  `;
  if (input.actorLocationId && input.actorLocationId !== input.destination.entityId) {
    await sql`
      INSERT INTO game.entity_relations (
        world_id, source_instance_id, target_instance_id, relation_type, parameters
      ) VALUES (
        ${input.scope.worldId},
        ${input.actorLocationId},
        ${input.destination.entityId},
        'adjacent_to',
        ${serializeJson({ travel_time_seconds: 180, source: "osm_bind" })}::jsonb
      )
      ON CONFLICT (source_instance_id, target_instance_id, relation_type) DO NOTHING
    `;
  }
  return input.destination;
}
