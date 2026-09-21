import { describe, expect, it } from "vitest";
import { DEFAULT_SHARD_ID, DEFAULT_WORLD_ID } from "@nocturne/database";
import { assertLegacyConsumptionScope } from "./legacy-consumption-scope.js";

describe("legacy consumption world isolation", () => {
  it("accepts only the shared-world scope supported by the legacy store", () => {
    expect(() => assertLegacyConsumptionScope({ worldId: DEFAULT_WORLD_ID, shardId: DEFAULT_SHARD_ID })).not.toThrow();
  });

  it.each([
    ["foreign world", "11111111-1111-4111-8111-111111111111", DEFAULT_SHARD_ID],
    ["foreign shard", DEFAULT_WORLD_ID, "22222222-2222-4222-8222-222222222222"],
    ["different world and shard", "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
  ])("rejects %s before legacy state is read or mutated", (_case, worldId, shardId) => {
    expect(() => assertLegacyConsumptionScope({ worldId, shardId })).toThrow(
      /Consumption is unavailable in this isolated world/,
    );
  });
});
