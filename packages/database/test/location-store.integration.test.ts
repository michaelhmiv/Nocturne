import { execFile } from "node:child_process";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, createLocationStore } from "../src/index.js";

const execFileAsync = promisify(execFile);
const baseUrl = process.env.DATABASE_URL;
const describePostgres = baseUrl ? describe : describe.skip;

function uuid(value: number) {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

describePostgres("authoritative location store (PostgreSQL)", () => {
  const databaseName = `nocturne_location_${process.pid}_${Date.now()}`;
  let databaseUrl: string;
  let database: ReturnType<typeof createDatabase>;
  let firstMigrationOutput = "";
  let secondMigrationOutput = "";

  beforeAll(async () => {
    const adminUrl = new URL(baseUrl!);
    adminUrl.pathname = "/postgres";
    const admin = postgres(adminUrl.toString(), { max: 1 });
    await admin`CREATE DATABASE ${admin(databaseName)}`;
    await admin.end();

    const testUrl = new URL(baseUrl!);
    testUrl.pathname = `/${databaseName}`;
    databaseUrl = testUrl.toString();
    const migration = async () =>
      execFileAsync("pnpm", ["exec", "tsx", "src/migrate.ts"], {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, DATABASE_URL: databaseUrl },
      });
    firstMigrationOutput = (await migration()).stdout;
    secondMigrationOutput = (await migration()).stdout;
    database = createDatabase(databaseUrl);
  });

  afterAll(async () => {
    await database?.close();
    const adminUrl = new URL(baseUrl!);
    adminUrl.pathname = "/postgres";
    const admin = postgres(adminUrl.toString(), { max: 1 });
    await admin`DROP DATABASE IF EXISTS ${admin(databaseName)} WITH (FORCE)`;
    await admin.end();
  });

  beforeEach(async () => {
    await database.client`TRUNCATE game.entity_definitions CASCADE`;
    await database.client`
      INSERT INTO game.entity_definitions (
        definition_id, definition_type, name, concept_summary, lifecycle_status
      ) VALUES
        ('test-location', 'location', 'Test Location', 'A test place.', 'approved'),
        ('test-character', 'character', 'Test Character', 'A test character.', 'approved')
    `;
  });

  async function instance(id: string, type: "location" | "character", locationId?: string) {
    await database.client`
      INSERT INTO game.entity_instances (instance_id, definition_id, location_id)
      VALUES (${id}, ${type === "location" ? "test-location" : "test-character"}, ${locationId ?? null})
    `;
  }

  async function playerCharacter(id: string, locationId: string) {
    await instance(id, "character", locationId);
    await database.client`
      INSERT INTO game.player_characters (user_id, character_instance_id)
      VALUES (${`user-${id}`}, ${id})
    `;
  }

  async function contain(childId: string, parentId: string, relationType = "located_within") {
    await database.client`
      INSERT INTO game.entity_relations (source_instance_id, target_instance_id, relation_type)
      VALUES (${childId}, ${parentId}, ${relationType})
    `;
  }

  it("applies migrations to a fresh database and the second run is a no-op", async () => {
    expect(firstMigrationOutput).toContain("Applied 0000_foundation.sql");
    expect(firstMigrationOutput).toContain("Applied 0003_consequential_actions.sql");
    expect(secondMigrationOutput).not.toContain("Applied ");

    const [result] = await database.client<
      { migration_count: number; has_location_fk: boolean; has_location_index: boolean }[]
    >`
      SELECT
        (SELECT count(*)::int FROM system.schema_migrations) AS migration_count,
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'game.entity_instances'::regclass
            AND conname = 'entity_instances_location_fk'
        ) AS has_location_fk,
        to_regclass('game.entity_instances_location_idx') IS NOT NULL AS has_location_index
    `;
    expect(result).toEqual({ migration_count: 4, has_location_fk: true, has_location_index: true });
  });

  it("finds a player character directly in an area", async () => {
    const area = uuid(1);
    const character = uuid(2);
    await instance(area, "location");
    await playerCharacter(character, area);

    await expect(createLocationStore(database).findPlayerCharacterOccupants(area)).resolves.toEqual(
      [character],
    );
  });

  it("finds a player character in a nested unit", async () => {
    const area = uuid(10);
    const room = uuid(11);
    const unit = uuid(12);
    const character = uuid(13);
    await instance(area, "location");
    await instance(room, "location", area);
    await instance(unit, "location", room);
    await contain(room, area);
    await contain(unit, room);
    await playerCharacter(character, unit);

    await expect(createLocationStore(database).findPlayerCharacterOccupants(area)).resolves.toEqual(
      [character],
    );
  });

  it("excludes occupants of adjacent locations", async () => {
    const area = uuid(20);
    const adjacent = uuid(21);
    const character = uuid(22);
    await instance(area, "location");
    await instance(adjacent, "location");
    await contain(adjacent, area, "adjacent_to");
    await playerCharacter(character, adjacent);

    await expect(createLocationStore(database).findPlayerCharacterOccupants(area)).resolves.toEqual(
      [],
    );
  });

  it("does not treat residence entitlement as physical presence", async () => {
    const area = uuid(30);
    const residence = uuid(31);
    const elsewhere = uuid(32);
    const character = uuid(33);
    await instance(area, "location");
    await instance(residence, "location", area);
    await instance(elsewhere, "location");
    await contain(residence, area);
    await playerCharacter(character, elsewhere);
    await database.client`
      INSERT INTO game.residence_occupancies (
        residence_instance_id, character_instance_id, user_id
      ) VALUES (${residence}, ${character}, 'resident')
    `;

    await expect(createLocationStore(database).findPlayerCharacterOccupants(area)).resolves.toEqual(
      [],
    );
  });

  it("includes offline characters without consulting session state", async () => {
    const area = uuid(40);
    const character = uuid(41);
    await instance(area, "location");
    await playerCharacter(character, area);

    const store = createLocationStore(database);
    expect(await store.findPlayerCharacterOccupants(area)).toEqual([character]);
    expect(await store.findPlayerCharacterOccupants(area)).toEqual([character]);
  });

  it("terminates recursive containment cycles", async () => {
    const first = uuid(50);
    const second = uuid(51);
    await instance(first, "location");
    await instance(second, "location", first);
    await contain(second, first);
    await contain(first, second);

    await expect(createLocationStore(database).findContainedLocationIds(first)).resolves.toEqual([
      first,
      second,
    ]);
  });

  it("rejects one of two concurrent moves with the same expected prior location", async () => {
    const prior = uuid(60);
    const firstDestination = uuid(61);
    const secondDestination = uuid(62);
    const character = uuid(63);
    await instance(prior, "location");
    await instance(firstDestination, "location");
    await instance(secondDestination, "location");
    await playerCharacter(character, prior);

    const store = createLocationStore(database);
    const results = await Promise.all([
      store.moveInstance({
        instanceId: character,
        locationId: firstDestination,
        expectedLocationId: prior,
      }),
      store.moveInstance({
        instanceId: character,
        locationId: secondDestination,
        expectedLocationId: prior,
      }),
    ]);
    expect(results.sort()).toEqual([false, true]);
  });

  it("accepts a caller-supplied Drizzle transaction", async () => {
    const prior = uuid(70);
    const destination = uuid(71);
    const character = uuid(72);
    await instance(prior, "location");
    await instance(destination, "location");
    await playerCharacter(character, prior);

    const store = createLocationStore(database);
    await expect(
      database.db.transaction(async (transaction) => {
        expect(
          await store.moveInstance(
            { instanceId: character, locationId: destination, expectedLocationId: prior },
            transaction,
          ),
        ).toBe(true);
        return store.findPlayerCharacterOccupants(destination, transaction);
      }),
    ).resolves.toEqual([character]);
  });
});
