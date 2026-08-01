import { randomUUID } from "node:crypto";
import {
  NarrativeMemorySchema,
  RecentTurnSchema,
  SceneContextSchema,
  type NarrativeMemory,
  type RecentTurn,
  type SceneContext,
  type WorldActionPlayerSafeResult,
} from "@nocturne/contracts";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";
import type { WorldScope } from "./world-store.js";

const bounded = (value: number, minimum: number, maximum: number) =>
  Math.max(minimum, Math.min(maximum, Math.floor(value)));

const iso = (value: Date | string) => new Date(value).toISOString();

function narration(result: WorldActionPlayerSafeResult | null) {
  if (!result) return null;
  if ("narration" in result) return result.narration;
  if ("prompt" in result) return result.prompt;
  return null;
}

function eventIds(result: WorldActionPlayerSafeResult | null) {
  return result && "eventIds" in result ? result.eventIds : [];
}

export type NarrativeContextProjection = {
  currentScene: SceneContext;
  recentTurns: RecentTurn[];
  relevantMemories: NarrativeMemory[];
};

export function createNarrativeMemoryStore(database: ReturnType<typeof createDatabase>) {
  async function currentLocation(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    viewpointId: string;
  }) {
    const rows = await database.client<
      {
        location_id: string | null;
        location_name: string | null;
        location_description: string | null;
      }[]
    >`
      SELECT actor.location_id,
             definition.name AS location_name,
             definition.concept_summary AS location_description
      FROM game.entity_instances actor
      LEFT JOIN game.entity_instances location
        ON location.instance_id = actor.location_id
       AND location.world_id = actor.world_id
       AND location.shard_id = actor.shard_id
      LEFT JOIN game.entity_definitions definition
        ON definition.definition_id = location.definition_id
      WHERE actor.world_id = ${input.scope.worldId}
        AND actor.shard_id = ${input.scope.shardId}
        AND actor.instance_id = ${input.viewpointId}
      LIMIT 1
    `;
    return rows[0] || null;
  }

  async function compile(input: {
    scope: WorldScope;
    viewpointId: string;
    command: string;
    recentTurnLimit?: number;
    memoryLimit?: number;
  }): Promise<NarrativeContextProjection> {
    const location = await currentLocation(input);
    const recentTurnLimit = bounded(input.recentTurnLimit ?? 8, 1, 12);
    const memoryLimit = bounded(input.memoryLimit ?? 16, 1, 32);

    const summaryRows = await database.client<{ summary: string; unresolved_threads: unknown }[]>`
      SELECT summary, unresolved_threads
      FROM game.scene_summaries
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND viewpoint_id = ${input.viewpointId}
        AND location_id IS NOT DISTINCT FROM ${location?.location_id ?? null}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const summary = summaryRows[0];
    const unresolvedThreads = Array.isArray(summary?.unresolved_threads)
      ? summary.unresolved_threads
          .filter((value): value is string => typeof value === "string")
          .slice(0, 24)
      : [];
    const currentScene = SceneContextSchema.parse({
      locationId: location?.location_id ?? null,
      locationName: location?.location_name || "Unknown location",
      locationDescription: location?.location_description || "",
      summary: summary?.summary || location?.location_description || "",
      unresolvedThreads,
    });

    const turnRows = await database.client<
      {
        request_id: string;
        command: string;
        player_safe_result: WorldActionPlayerSafeResult | null;
        created_at: Date | string;
      }[]
    >`
      SELECT request_id, command, player_safe_result, created_at
      FROM game.world_action_requests
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND actor_id = ${input.viewpointId}
        AND status = 'completed'
        AND player_safe_result IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ${recentTurnLimit}
    `;
    const recentTurns = turnRows
      .map((row) => {
        const playerSafeResult = narration(row.player_safe_result);
        if (!playerSafeResult) return null;
        return RecentTurnSchema.parse({
          requestId: row.request_id,
          command: row.command,
          playerSafeResult,
          eventIds: eventIds(row.player_safe_result),
          occurredAt: iso(row.created_at),
        });
      })
      .filter((turn): turn is RecentTurn => Boolean(turn))
      .reverse();

    const memoryRows = await database.client<
      {
        memory_id: string;
        summary: string;
        location_id: string | null;
        salience: number;
        visibility: "player_known";
        unresolved: boolean;
        occurred_at: Date | string;
        source_event_ids: string[] | null;
        mentioned_entity_ids: string[] | null;
      }[]
    >`
      SELECT memory.memory_id, memory.summary, memory.location_id, memory.salience,
             memory.visibility, memory.unresolved, memory.occurred_at,
             ARRAY(
               SELECT source.event_id::text
               FROM game.memory_source_events source
               WHERE source.memory_id = memory.memory_id
               ORDER BY source.event_id
             ) AS source_event_ids,
             ARRAY(
               SELECT mention.entity_id::text
               FROM game.memory_mentions mention
               WHERE mention.memory_id = memory.memory_id
               ORDER BY mention.entity_id
             ) AS mentioned_entity_ids
      FROM game.narrative_memories memory
      WHERE memory.world_id = ${input.scope.worldId}
        AND memory.shard_id = ${input.scope.shardId}
        AND memory.viewpoint_id = ${input.viewpointId}
        AND memory.visibility = 'player_known'
        AND (memory.expires_at IS NULL OR memory.expires_at > now())
        AND NOT EXISTS (
          SELECT 1
          FROM game.world_action_requests recent
          WHERE recent.request_id = memory.source_request_id
            AND recent.request_id = ANY(${recentTurns.map((turn) => turn.requestId)}::uuid[])
        )
      ORDER BY
        (memory.location_id IS NOT DISTINCT FROM ${location?.location_id ?? null}) DESC,
        memory.unresolved DESC,
        memory.salience DESC,
        memory.occurred_at DESC
      LIMIT ${memoryLimit}
    `;
    const relevantMemories = memoryRows
      .filter((row) => (row.source_event_ids || []).length > 0)
      .map((row) =>
        NarrativeMemorySchema.parse({
          memoryId: row.memory_id,
          summary: row.summary,
          sourceEventIds: row.source_event_ids || [],
          mentionedEntityIds: row.mentioned_entity_ids || [],
          locationId: row.location_id,
          salience: row.salience,
          visibility: row.visibility,
          unresolved: row.unresolved,
          occurredAt: iso(row.occurred_at),
        }),
      );

    return { currentScene, recentTurns, relevantMemories };
  }

  async function recordCompletedTurn(input: {
    scope: WorldScope;
    viewpointId: string;
    requestId: string;
    narration: string;
    eventIds: string[];
    mentionedEntityIds?: string[];
    salience?: number;
    unresolved?: boolean;
  }) {
    const uniqueEventIds = [...new Set(input.eventIds)];
    if (!uniqueEventIds.length) return null;
    const location = await currentLocation(input);
    const memoryId = randomUUID();
    const rows = await database.client<{ memory_id: string }[]>`
      INSERT INTO game.narrative_memories (
        memory_id, world_id, shard_id, viewpoint_id, location_id,
        source_request_id, summary, salience, visibility, unresolved, occurred_at
      ) VALUES (
        ${memoryId}, ${input.scope.worldId}, ${input.scope.shardId}, ${input.viewpointId},
        ${location?.location_id ?? null}, ${input.requestId}, ${input.narration.slice(0, 8000)},
        ${bounded(input.salience ?? 100, -10000, 10000)}, 'player_known',
        ${input.unresolved ?? false}, now()
      )
      ON CONFLICT (world_id, shard_id, viewpoint_id, source_request_id) DO UPDATE
      SET summary = EXCLUDED.summary,
          location_id = EXCLUDED.location_id,
          salience = EXCLUDED.salience,
          unresolved = EXCLUDED.unresolved,
          occurred_at = EXCLUDED.occurred_at
      RETURNING memory_id
    `;
    const persistedMemoryId = rows[0]?.memory_id;
    if (!persistedMemoryId) return null;

    for (const eventId of uniqueEventIds) {
      await database.client`
        INSERT INTO game.memory_source_events (memory_id, event_id)
        VALUES (${persistedMemoryId}, ${eventId})
        ON CONFLICT DO NOTHING
      `;
    }
    const mentionedEntityIds = [
      ...new Set([input.viewpointId, ...(input.mentionedEntityIds || [])]),
    ];
    for (const entityId of mentionedEntityIds) {
      await database.client`
        INSERT INTO game.memory_mentions (memory_id, entity_id)
        SELECT ${persistedMemoryId}, ${entityId}
        WHERE EXISTS (
          SELECT 1 FROM game.entity_instances
          WHERE world_id = ${input.scope.worldId}
            AND shard_id = ${input.scope.shardId}
            AND instance_id = ${entityId}
        )
        ON CONFLICT DO NOTHING
      `;
    }

    await database.client`
      INSERT INTO game.scene_summaries (
        scene_summary_id, world_id, shard_id, viewpoint_id, location_id,
        summary, unresolved_threads, source_event_ids, updated_at
      ) VALUES (
        ${randomUUID()}, ${input.scope.worldId}, ${input.scope.shardId}, ${input.viewpointId},
        ${location?.location_id ?? null}, ${input.narration.slice(0, 4000)}, '[]'::jsonb,
        ${json(uniqueEventIds)}::jsonb, now()
      )
      ON CONFLICT (world_id, shard_id, viewpoint_id, location_id) DO UPDATE
      SET summary = EXCLUDED.summary,
          source_event_ids = EXCLUDED.source_event_ids,
          updated_at = now()
    `;
    return persistedMemoryId;
  }

  return { compile, recordCompletedTurn };
}

export type NarrativeMemoryStore = ReturnType<typeof createNarrativeMemoryStore>;
