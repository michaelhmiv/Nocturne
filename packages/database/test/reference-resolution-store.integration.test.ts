import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_SHARD_ID,
  DEFAULT_WORLD_ID,
  createDatabase,
  createReferenceResolutionStore,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

const viewpointId = "00000000-0000-4000-8000-000000000401";
const wrenchId = "00000000-0000-4000-8000-000000000402";

describePostgres("reference resolution audit replay (PostgreSQL)", () => {
  const database = createDatabase(databaseUrl!);
  const store = createReferenceResolutionStore(database);
  const scope = {
    worldId: DEFAULT_WORLD_ID,
    shardId: DEFAULT_SHARD_ID,
    userId: "reference-replay-user",
  };

  beforeAll(async () => {
    await execFileAsync("pnpm", ["exec", "tsx", "src/migrate.ts"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });

    await database.client`
      INSERT INTO game.entity_definitions (
        definition_id, definition_type, name, concept_summary, lifecycle_status, world_id
      ) VALUES
        ('reference_replay_actor', 'character', 'Reference Replay Actor', 'Audit replay fixture', 'approved', ${DEFAULT_WORLD_ID}),
        ('reference_replay_wrench', 'item', 'Certification Wrench', 'Audit replay fixture', 'approved', ${DEFAULT_WORLD_ID})
      ON CONFLICT (definition_id) DO NOTHING
    `;
    await database.client`
      INSERT INTO game.entity_instances (
        instance_id, definition_id, world_id, shard_id, state
      ) VALUES
        (${viewpointId}, 'reference_replay_actor', ${DEFAULT_WORLD_ID}, ${DEFAULT_SHARD_ID}, '{}'),
        (${wrenchId}, 'reference_replay_wrench', ${DEFAULT_WORLD_ID}, ${DEFAULT_SHARD_ID}, '{}')
      ON CONFLICT (instance_id) DO NOTHING
    `;
    await database.client`
      DELETE FROM game.entity_reference_resolutions
      WHERE world_id = ${DEFAULT_WORLD_ID}
        AND viewpoint_instance_id = ${viewpointId}
    `;
  });

  afterAll(() => database.close());

  it("reuses a duplicate audit row without aborting the transaction", async () => {
    const candidate = {
      entityId: wrenchId,
      displayName: "Certification Wrench",
      definitionType: "item",
      lifecycleStatus: "active",
      locationId: null,
      aliases: ["Certification Wrench", "wrench"],
      relationshipLabels: [],
      relevanceScore: 100,
      accessible: true,
      present: true,
      supportingFactIds: [],
    };
    const interpretation = {
      mentions: [
        {
          order: 1,
          mentionText: "Certification Wrench",
          mentionKind: "proper_name" as const,
          status: "resolved" as const,
          selectedEntityId: wrenchId,
          candidateEntityIds: [wrenchId],
          confidenceBasisPoints: 9900,
          supportingFactIds: [],
          requiresClarification: false,
          rationale: "Exact persistent candidate match.",
        },
      ],
    };
    const input = {
      scope,
      viewpointId,
      command: "Pick up the Certification Wrench.",
      interpretation,
      candidates: [candidate],
    };

    const first = await store.recordInterpretation(input);
    const replay = await store.recordInterpretation(input);

    expect(replay.commandHash).toBe(first.commandHash);
    expect(replay.resolutionIds).toEqual(first.resolutionIds);

    const rows = await database.client<{ count: number }[]>`
      SELECT count(*)::int AS count
      FROM game.entity_reference_resolutions
      WHERE world_id = ${DEFAULT_WORLD_ID}
        AND viewpoint_instance_id = ${viewpointId}
        AND command_hash = ${first.commandHash}
    `;
    expect(rows[0]?.count).toBe(1);
  });
});
