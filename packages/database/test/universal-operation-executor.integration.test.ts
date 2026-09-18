import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_SHARD_ID,
  DEFAULT_WORLD_ID,
  createDatabase,
  createUniversalOperationExecutor,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

const containerA = "00000000-0000-4000-8000-000000000301";
const containerB = "00000000-0000-4000-8000-000000000302";
const containerC = "00000000-0000-4000-8000-000000000303";

describePostgres("universal operation containment invariants (PostgreSQL)", () => {
  const database = createDatabase(databaseUrl!);
  const executor = createUniversalOperationExecutor(database);
  const scope = {
    worldId: DEFAULT_WORLD_ID,
    shardId: DEFAULT_SHARD_ID,
    userId: "containment-invariant-operator",
    role: "owner" as const,
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
        ('containment_test_a', 'container', 'Container A', 'Containment invariant test', 'approved', ${DEFAULT_WORLD_ID}),
        ('containment_test_b', 'container', 'Container B', 'Containment invariant test', 'approved', ${DEFAULT_WORLD_ID}),
        ('containment_test_c', 'container', 'Container C', 'Containment invariant test', 'approved', ${DEFAULT_WORLD_ID})
      ON CONFLICT (definition_id) DO NOTHING
    `;
    await database.client`
      INSERT INTO game.entity_instances (
        instance_id, definition_id, world_id, shard_id, state
      ) VALUES
        (${containerA}, 'containment_test_a', ${DEFAULT_WORLD_ID}, ${DEFAULT_SHARD_ID}, '{}'),
        (${containerB}, 'containment_test_b', ${DEFAULT_WORLD_ID}, ${DEFAULT_SHARD_ID}, '{}'),
        (${containerC}, 'containment_test_c', ${DEFAULT_WORLD_ID}, ${DEFAULT_SHARD_ID}, '{}')
      ON CONFLICT (instance_id) DO NOTHING
    `;
    await database.client`
      DELETE FROM game.entity_relations
      WHERE world_id = ${DEFAULT_WORLD_ID}
        AND source_instance_id = ANY(${[containerA, containerB, containerC]}::uuid[])
        AND relation_type = 'contained_in'
    `;
  });

  afterAll(() => database.close());

  async function contain(sourceId: string, targetId: string, key: string) {
    return executor.execute({
      scope,
      authority: "operator",
      idempotencyKey: key,
      declaredFactIds: [],
      branch: {
        operations: [
          {
            type: "set_relation",
            sourceRef: { kind: "existing", entityId: sourceId },
            targetRef: { kind: "existing", entityId: targetId },
            relationType: "contained_in",
            parameters: { visibility: "player_known" },
            preconditionFactIds: [],
          },
        ],
      },
      playerVisibleFacts: [],
      hiddenFacts: [],
    });
  }

  it("rejects recursive containment and commits no reverse relation", async () => {
    await contain(containerA, containerB, "containment:a-in-b");

    await expect(contain(containerB, containerA, "containment:b-in-a")).rejects.toMatchObject({
      code: "containment_cycle",
    });

    const relations = await database.client<
      { source_instance_id: string; target_instance_id: string }[]
    >`
      SELECT source_instance_id, target_instance_id
      FROM game.entity_relations
      WHERE world_id = ${DEFAULT_WORLD_ID}
        AND relation_type = 'contained_in'
        AND source_instance_id = ANY(${[containerA, containerB]}::uuid[])
      ORDER BY source_instance_id, target_instance_id
    `;
    expect(relations).toEqual([{ source_instance_id: containerA, target_instance_id: containerB }]);
  });

  it("maintains one active containment parent when an item is moved", async () => {
    await contain(containerA, containerC, "containment:a-in-c");

    const relations = await database.client<{ target_instance_id: string }[]>`
      SELECT target_instance_id
      FROM game.entity_relations
      WHERE world_id = ${DEFAULT_WORLD_ID}
        AND source_instance_id = ${containerA}
        AND relation_type = 'contained_in'
    `;
    expect(relations).toEqual([{ target_instance_id: containerC }]);
  });
});
