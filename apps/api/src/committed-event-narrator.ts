import { narratePlayerSafeFacts, type AiProviderClient } from "@nocturne/ai-gm";
import type { WorldScope } from "@nocturne/database";

export type CommittedEventNarrationEvidence = {
  eventId: string;
  eventType: string;
  worldId: string;
  shardId: string;
  actorId: string;
  playerVisibleFacts: string[];
};

/**
 * The creative model sees only facts from committed, actor-scoped receipts.
 * Its prose is never used to construct an authoritative operation or event.
 * If a receipt is missing or narration fails, return receipt facts (or the
 * existing deterministic response), and expose the failure to telemetry.
 */
export function createCommittedEventNarrator(input: {
  client: Pick<AiProviderClient, "generateText">;
  readEvidence(request: {
    scope: WorldScope;
    actorId: string;
    eventIds: string[];
  }): Promise<CommittedEventNarrationEvidence[]>;
  onFailure?(error: unknown, eventIds: string[]): void;
}) {
  return async function narrate(request: {
    scope: WorldScope;
    actorId: string;
    eventIds: string[];
    fallback: string;
  }): Promise<string> {
    if (request.eventIds.length === 0) return request.fallback;
    let supportedFacts: string[] = [];
    try {
      const expected = new Set(request.eventIds);
      const rows = await input.readEvidence(request);
      if (rows.length !== expected.size) {
        throw new Error("Committed narration is missing an actor-scoped mutation receipt.");
      }
      for (const row of rows) {
        if (
          !expected.delete(row.eventId) ||
          row.worldId !== request.scope.worldId ||
          row.shardId !== request.scope.shardId ||
          row.actorId !== request.actorId
        ) {
          throw new Error(
            "Committed narration evidence did not match the authenticated actor and world.",
          );
        }
        supportedFacts.push(
          ...row.playerVisibleFacts.filter((fact) => typeof fact === "string" && fact.trim()),
        );
      }
      if (expected.size > 0 || supportedFacts.length === 0) {
        throw new Error("Committed narration has no complete player-visible factual evidence.");
      }
      if (rows.some(({ eventType }) => eventType === "action_failed")) {
        return supportedFacts.join(" ");
      }
      const result = await narratePlayerSafeFacts(input.client, {
        eventType: rows.map((row) => row.eventType).join(","),
        playerVisibleFacts: supportedFacts,
        constraints: [
          "Describe only the effects actually committed in the supplied receipts.",
          "Do not imply a purchase, transfer, job, injury, or arrival unless supported by these facts.",
        ],
        style: "immersive",
      });
      return result.text;
    } catch (error) {
      input.onFailure?.(error, request.eventIds);
      return supportedFacts.length ? supportedFacts.join(" ") : request.fallback;
    }
  };
}
