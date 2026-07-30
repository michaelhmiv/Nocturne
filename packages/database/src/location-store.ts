import { sql } from "drizzle-orm";
import type { createDatabase } from "./index.js";

export type MoveInstanceInput = {
  instanceId: string;
  locationId: string;
  expectedLocationId?: string | null;
};

export type TravelPath = {
  path: string[];           // ordered location instance IDs
  totalTimeSeconds: number; // sum of edge travel times
};

export function createLocationStore(database: ReturnType<typeof createDatabase>) {
  type Executor = Pick<typeof database.db, "execute">;

  async function moveInstance(
    input: MoveInstanceInput,
    executor: Executor = database.db,
  ): Promise<boolean> {
    const expectation =
      input.expectedLocationId === undefined
        ? sql``
        : sql`AND location_id IS NOT DISTINCT FROM ${input.expectedLocationId}`;
    const rows = await executor.execute<{ instanceId: string }>(sql`
      UPDATE game.entity_instances
      SET location_id = ${input.locationId}, updated_at = now()
      WHERE instance_id = ${input.instanceId} ${expectation}
      RETURNING instance_id AS "instanceId"
    `);
    return rows.length === 1;
  }

  async function findContainedLocationIds(
    locationId: string,
    executor: Executor = database.db,
  ): Promise<string[]> {
    const rows = await executor.execute<{ locationId: string }>(sql`
      WITH RECURSIVE contained(location_id) AS (
        SELECT instance_id
        FROM game.entity_instances
        WHERE instance_id = ${locationId}
        UNION
        SELECT relation.source_instance_id
        FROM game.entity_relations relation
        JOIN contained parent ON parent.location_id = relation.target_instance_id
        WHERE relation.relation_type = 'located_within'
      )
      SELECT location_id AS "locationId"
      FROM contained
      ORDER BY location_id
    `);
    return rows.map((row) => row.locationId);
  }

  async function findPlayerCharacterOccupants(
    locationId: string,
    executor: Executor = database.db,
  ): Promise<string[]> {
    const rows = await executor.execute<{ characterInstanceId: string }>(sql`
      WITH RECURSIVE contained(location_id) AS (
        SELECT instance_id
        FROM game.entity_instances
        WHERE instance_id = ${locationId}
        UNION
        SELECT relation.source_instance_id
        FROM game.entity_relations relation
        JOIN contained parent ON parent.location_id = relation.target_instance_id
        WHERE relation.relation_type = 'located_within'
      )
      SELECT character.character_instance_id AS "characterInstanceId"
      FROM game.player_characters character
      JOIN game.entity_instances instance
        ON instance.instance_id = character.character_instance_id
      JOIN contained ON contained.location_id = instance.location_id
      ORDER BY character.character_instance_id
    `);
    return rows.map((row) => row.characterInstanceId);
  }

  // ponytail: Dijkstra shortest-path via recursive CTE on entity_relations.
  // Travel edges: relation_type IN ('adjacent_to', 'accessible_via').
  // Edge weight from parameters->>'travel_time_seconds' (default 60s).
  // vehicleSpeedFactor divides total time (bike 2.5x faster → time / 2.5).
  async function findShortestPath(
    fromLocationId: string,
    toLocationId: string,
    vehicleSpeedFactor = 1,
    executor: Executor = database.db,
  ): Promise<TravelPath | null> {
    const rows = await executor.execute<{
      path: string[];
      total_time_seconds: number;
    }>(sql`
      WITH RECURSIVE paths(node_id, path, total_time, depth) AS (
        SELECT
          ${fromLocationId}::uuid AS node_id,
          ARRAY[${fromLocationId}::uuid] AS path,
          0::numeric AS total_time,
          0 AS depth
        UNION
        SELECT
          CASE
            WHEN rel.source_instance_id = paths.node_id THEN rel.target_instance_id
            ELSE rel.source_instance_id
          END AS node_id,
          paths.path || CASE
            WHEN rel.source_instance_id = paths.node_id THEN rel.target_instance_id
            ELSE rel.source_instance_id
          END,
          paths.total_time + COALESCE(
            (rel.parameters->>'travel_time_seconds')::numeric, 60
          ),
          paths.depth + 1
        FROM paths
        JOIN game.entity_relations rel
          ON (rel.source_instance_id = paths.node_id OR rel.target_instance_id = paths.node_id)
          AND rel.relation_type IN ('adjacent_to', 'accessible_via')
        WHERE paths.depth < 50
          AND NOT (CASE
            WHEN rel.source_instance_id = paths.node_id THEN rel.target_instance_id
            ELSE rel.source_instance_id
          END) = ANY(paths.path)
      )
      SELECT
        path,
        total_time::numeric AS total_time_seconds
      FROM paths
      WHERE node_id = ${toLocationId}::uuid
      ORDER BY total_time
      LIMIT 1
    `);
    if (!rows[0]) return null;
    const factor = Math.max(0.1, vehicleSpeedFactor || 1);
    return {
      path: rows[0].path,
      totalTimeSeconds: Math.max(1, Math.round(Number(rows[0].total_time_seconds) / factor)),
    };
  }

  async function listVehicles(ownerId?: string) {
    const rows = ownerId
      ? await database.client`
          SELECT instance_id, owner_id, location_id, state
          FROM game.entity_instances
          WHERE definition_id = 'vehicle'
            AND (owner_id = ${ownerId} OR owner_id IS NULL)
          ORDER BY created_at
        `
      : await database.client`
          SELECT instance_id, owner_id, location_id, state
          FROM game.entity_instances
          WHERE definition_id = 'vehicle'
          ORDER BY created_at
        `;
    return rows.map((r) => {
      const st = (r.state as Record<string, unknown>) || {};
      return {
        vehicleId: String(r.instance_id),
        ownerId: r.owner_id ? String(r.owner_id) : null,
        locationId: r.location_id ? String(r.location_id) : null,
        name: String(st.name || "Vehicle"),
        speedFactor: Number(st.speedFactor || 1),
        forSale: Boolean(st.forSale),
        priceCents: Number(st.priceCents || 0),
      };
    });
  }

  async function claimVehicle(ownerId: string, vehicleId: string) {
    const rows = await database.client`
      UPDATE game.entity_instances
      SET owner_id = ${ownerId},
          state = coalesce(state, '{}'::jsonb) || '{"forSale":false}'::jsonb,
          updated_at = now()
      WHERE instance_id = ${vehicleId}
        AND definition_id = 'vehicle'
        AND owner_id IS NULL
      RETURNING instance_id, state
    `;
    if (!rows[0]) return null;
    const st = (rows[0].state as Record<string, unknown>) || {};
    return {
      vehicleId: String(rows[0].instance_id),
      ownerId,
      speedFactor: Number(st.speedFactor || 1),
      name: String(st.name || "Vehicle"),
    };
  }

  return {
    moveInstance,
    findContainedLocationIds,
    findPlayerCharacterOccupants,
    findShortestPath,
    listVehicles,
    claimVehicle,
  };
}

export type LocationStore = ReturnType<typeof createLocationStore>;
