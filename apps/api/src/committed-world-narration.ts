import { narratePlayerSafeFacts, type AiProviderClient } from "@nocturne/ai-gm";
import type { createDatabase, WorldScope } from "@nocturne/database";

/**
 * Laguna only receives player-visible facts from events already committed to
 * the actor's authoritative world and shard. Hidden facts and model proposals
 * are never narration input. The caller retains a deterministic fallback if
 * the prose provider is unavailable after the gameplay transaction commits.
 */
export function createCommittedWorldNarrator(
  database: ReturnType<typeof createDatabase>,
  client: Pick<AiProviderClient, "generateText">,
) {
  return async function narrateCommittedResult(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    eventIds: string[];
    fallbackNarration: string;
  }): Promise<string> {
    const eventIds = [...new Set(input.eventIds)];
    if (eventIds.length === 0) return input.fallbackNarration;

    const rows = await database.client<
      { event_id: string; event_type: string; payload: Record<string, unknown> }[]
    >`
      SELECT event_id, event_type, payload
      FROM game.event_ledger
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND event_id = ANY(${database.client.array(eventIds, 2950)})
      ORDER BY world_time, event_id
    `;
    if (rows.length !== eventIds.length) {
      throw new Error("Cannot narrate an event outside the active world and shard.");
    }

    const playerVisibleFacts = rows
      .flatMap((row) =>
        Array.isArray(row.payload?.playerVisibleFacts) ? row.payload.playerVisibleFacts : [],
      )
      .filter((fact): fact is string => typeof fact === "string" && Boolean(fact.trim()))
      .slice(0, 32);
    if (playerVisibleFacts.length === 0) return input.fallbackNarration;

    const result = await narratePlayerSafeFacts(client, {
      eventType: rows.map(({ event_type }) => event_type).join(", "),
      playerVisibleFacts,
      style: "immersive",
    });
    return result.text.trim() || input.fallbackNarration;
  };
}
