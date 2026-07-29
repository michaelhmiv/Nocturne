import { sql } from "drizzle-orm";
import type { createDatabase } from "./index.js";

export type MoveInstanceInput = {
  instanceId: string;
  locationId: string;
  expectedLocationId?: string | null;
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

  return { moveInstance, findContainedLocationIds, findPlayerCharacterOccupants };
}

export type LocationStore = ReturnType<typeof createLocationStore>;
