import type { createDatabase } from "./index.js";
import { DEFAULT_SHARD_ID, DEFAULT_WORLD_ID } from "./world-schema.js";

export type WorldScope = {
  worldId: string;
  shardId: string;
  userId: string;
  role: "player" | "moderator" | "operator" | "owner";
  selectedCharacterId: string | null;
};

export class WorldScopeError extends Error {
  constructor(
    readonly code:
      | "world_not_found"
      | "membership_not_found"
      | "membership_inactive"
      | "shard_not_found"
      | "cross_world_reference",
    message: string,
  ) {
    super(message);
    this.name = "WorldScopeError";
  }
}

export function createWorldStore(database: ReturnType<typeof createDatabase>) {
  async function resolveForUser(input: {
    userId: string;
    worldId?: string;
    shardId?: string;
  }): Promise<WorldScope> {
    const worldId = input.worldId || DEFAULT_WORLD_ID;
    const shardId = input.shardId || DEFAULT_SHARD_ID;
    const rows = await database.client<
      {
        world_id: string;
        shard_id: string;
        role: WorldScope["role"];
        membership_status: string;
        shard_status: string;
        selected_character_id: string | null;
      }[]
    >`
      SELECT membership.world_id,
             shard.shard_id,
             membership.role,
             membership.status AS membership_status,
             shard.status AS shard_status,
             membership.selected_character_id
      FROM game.world_memberships membership
      JOIN game.worlds world
        ON world.world_id = membership.world_id
      JOIN game.world_shards shard
        ON shard.world_id = membership.world_id
       AND shard.shard_id = ${shardId}
      WHERE membership.world_id = ${worldId}
        AND membership.user_id = ${input.userId}
    `;
    const row = rows[0];
    if (!row) {
      const world = await database.client`
        SELECT 1 FROM game.worlds WHERE world_id = ${worldId}
      `;
      if (!world[0]) throw new WorldScopeError("world_not_found", "World not found.");
      const membership = await database.client`
        SELECT 1
        FROM game.world_memberships
        WHERE world_id = ${worldId} AND user_id = ${input.userId}
      `;
      if (!membership[0])
        throw new WorldScopeError("membership_not_found", "User is not a member of this world.");
      throw new WorldScopeError("shard_not_found", "Shard not found in the selected world.");
    }
    if (row.membership_status !== "active") {
      throw new WorldScopeError("membership_inactive", "World membership is not active.");
    }
    if (row.shard_status !== "active") {
      throw new WorldScopeError("shard_not_found", "Shard is not active.");
    }
    return {
      worldId: row.world_id,
      shardId: row.shard_id,
      userId: input.userId,
      role: row.role,
      selectedCharacterId: row.selected_character_id,
    };
  }

  async function requireEntitiesInScope(
    scope: Pick<WorldScope, "worldId" | "shardId">,
    entityIds: string[],
  ): Promise<void> {
    const unique = [...new Set(entityIds)];
    if (unique.length === 0) return;
    const rows = await database.client<{ instance_id: string }[]>`
      SELECT instance_id
      FROM game.entity_instances
      WHERE world_id = ${scope.worldId}
        AND shard_id = ${scope.shardId}
        AND instance_id = ANY(${unique}::uuid[])
    `;
    const found = new Set(rows.map((row) => row.instance_id));
    if (unique.some((id) => !found.has(id))) {
      throw new WorldScopeError(
        "cross_world_reference",
        "One or more entities are outside the active world and shard.",
      );
    }
  }

  async function ensureMembership(input: {
    userId: string;
    worldId?: string;
    role?: WorldScope["role"];
  }): Promise<void> {
    const worldId = input.worldId || DEFAULT_WORLD_ID;
    await database.client`
      INSERT INTO game.world_memberships (world_id, user_id, role, status)
      VALUES (${worldId}, ${input.userId}, ${input.role || "player"}, 'active')
      ON CONFLICT (world_id, user_id) DO UPDATE
      SET status = CASE
            WHEN game.world_memberships.status = 'left' THEN 'active'
            ELSE game.world_memberships.status
          END,
          updated_at = now()
    `;
  }

  async function setSelectedCharacter(input: {
    scope: WorldScope;
    characterId: string;
  }): Promise<void> {
    const rows = await database.client`
      SELECT 1
      FROM game.player_characters character
      JOIN game.entity_instances instance
        ON instance.instance_id = character.character_instance_id
      WHERE character.world_id = ${input.scope.worldId}
        AND character.user_id = ${input.scope.userId}
        AND character.character_instance_id = ${input.characterId}
        AND instance.world_id = ${input.scope.worldId}
        AND instance.shard_id = ${input.scope.shardId}
    `;
    if (!rows[0]) {
      throw new WorldScopeError(
        "cross_world_reference",
        "Character is not controlled by this user in the active world and shard.",
      );
    }
    await database.client`
      UPDATE game.world_memberships
      SET selected_character_id = ${input.characterId}, updated_at = now()
      WHERE world_id = ${input.scope.worldId}
        AND user_id = ${input.scope.userId}
    `;
  }

  return {
    resolveForUser,
    requireEntitiesInScope,
    ensureMembership,
    setSelectedCharacter,
  };
}

export type WorldStore = ReturnType<typeof createWorldStore>;
