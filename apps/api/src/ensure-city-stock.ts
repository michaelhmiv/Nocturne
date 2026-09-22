import { serializeJson, type createDatabase, type WorldScope } from "@nocturne/database";
import type { StockSlot } from "@nocturne/contracts";
import { stableEntityId, type ResolvedCityDestination } from "./resolve-city-destination.js";

const ITEM_DEFINITION_PREFIX = "city-stock";

export async function ensureCityStock(input: {
  database: ReturnType<typeof createDatabase>;
  scope: Pick<WorldScope, "worldId" | "shardId">;
  actorId: string;
  place: Pick<ResolvedCityDestination, "entityId" | "sourceKey" | "name" | "family">;
  slot: StockSlot;
}) {
  const sql = input.database.client;
  const definitionId = `${ITEM_DEFINITION_PREFIX}-${input.slot.sku}`;
  const itemId = stableEntityId(
    `${input.place.sourceKey}:stock:${input.slot.sku}`,
    input.scope.worldId,
  );

  await sql`
    INSERT INTO game.entity_definitions (
      definition_id, definition_type, name, concept_summary, origin_source, lifecycle_status
    ) VALUES (
      ${definitionId},
      'item',
      ${input.slot.label},
      ${`Stock ${input.slot.label} bound from a city place.`},
      'city_stock',
      'approved'
    )
    ON CONFLICT (definition_id) DO NOTHING
  `;

  await sql`
    INSERT INTO game.entity_instances (
      instance_id, world_id, shard_id, definition_id, condition, state,
      version, lifecycle_status, provenance
    ) VALUES (
      ${itemId},
      ${input.scope.worldId},
      ${input.scope.shardId},
      ${definitionId},
      100,
      ${serializeJson({
        sku: input.slot.sku,
        family: input.slot.family,
        label: input.slot.label,
        sourceKey: input.place.sourceKey,
        placeName: input.place.name,
      })}::jsonb,
      0,
      'active',
      ${serializeJson({
        sourceType: "city_stock",
        sourceId: `${input.place.sourceKey}:${input.slot.sku}`,
      })}::jsonb
    )
    ON CONFLICT (instance_id) DO UPDATE
    SET world_id = EXCLUDED.world_id,
        shard_id = EXCLUDED.shard_id,
        updated_at = now()
  `;

  await sql`
    INSERT INTO game.entity_relations (
      world_id, source_instance_id, target_instance_id, relation_type, parameters
    ) VALUES (
      ${input.scope.worldId},
      ${itemId},
      ${input.actorId},
      'possessed_by',
      ${serializeJson({ visibility: "player_known", source: "city_stock" })}::jsonb
    )
    ON CONFLICT (source_instance_id, target_instance_id, relation_type) DO NOTHING
  `;

  return { itemId, label: input.slot.label, placeName: input.place.name };
}
