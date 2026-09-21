import {
  DEFAULT_SHARD_ID,
  DEFAULT_WORLD_ID,
  PersistentWorldError,
  type WorldScope,
} from "@nocturne/database";

/**
 * The legacy action store loads the shared starter alley and uses unscoped
 * actor/item/event queries. It must never process an isolated-world player.
 * Replace this guard only when consumption uses a fully world/shard-scoped
 * reader, executor, and atomic event writer.
 */
export function assertLegacyConsumptionScope(scope: Pick<WorldScope, "worldId" | "shardId">) {
  if (scope.worldId !== DEFAULT_WORLD_ID || scope.shardId !== DEFAULT_SHARD_ID) {
    throw new PersistentWorldError(
      "forbidden",
      "Consumption is unavailable in this isolated world until its scoped executor is enabled.",
    );
  }
}
