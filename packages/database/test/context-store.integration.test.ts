import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuthoritativeContextStore, createDatabase } from "../src/index.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;
const uuid = (value: number) => `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;

describePostgres("authoritative context store (PostgreSQL)", () => {
  const database = createDatabase(databaseUrl!);
  const store = createAuthoritativeContextStore(database);

  beforeAll(async () => {
    await execFileAsync("pnpm", ["exec", "tsx", "src/migrate.ts"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
  });

  afterAll(() => database.close());

  beforeEach(async () => {
    await database.client`TRUNCATE game.entity_definitions CASCADE`;
  });

  async function definition(id: string, type: string, name: string, summary = `${name} summary`) {
    const revisionId = randomUUID();
    await database.client`
      INSERT INTO game.entity_definitions (
        definition_id, definition_type, name, concept_summary, lifecycle_status
      ) VALUES (${id}, ${type}, ${name}, ${summary}, 'approved')
    `;
    await database.client`
      INSERT INTO game.definition_revisions (revision_id, definition_id, payload, change_summary)
      VALUES (${revisionId}, ${id}, '{}', 'test')
    `;
    await database.client`
      UPDATE game.entity_definitions SET current_revision_id = ${revisionId}
      WHERE definition_id = ${id}
    `;
  }

  async function instance(
    id: string,
    definitionId: string,
    options: {
      locationId?: string;
      ownerId?: string;
      condition?: number;
      state?: Record<string, unknown>;
    } = {},
  ) {
    await database.client`
      INSERT INTO game.entity_instances (
        instance_id, definition_id, location_id, owner_id, condition, state
      ) VALUES (
        ${id}, ${definitionId}, ${options.locationId ?? null}, ${options.ownerId ?? null},
        ${options.condition ?? 100}, ${JSON.stringify(options.state ?? {})}
      )
    `;
  }

  async function player(userId: string, id: string, locationId: string, selected = true) {
    await instance(id, "character", {
      locationId,
      condition: 73,
      state: { active: true, privateResource: 4 },
    });
    await database.client`
      INSERT INTO game.player_characters (user_id, character_instance_id, selected)
      VALUES (${userId}, ${id}, ${selected})
    `;
  }

  async function world() {
    await definition("place", "location", "Room");
    await definition("building", "location", "Building");
    await definition("character", "character", "Hero");
    await definition("item", "item", "Scanner");
    await instance(uuid(1), "building");
    await instance(uuid(2), "place", { locationId: uuid(1) });
    await database.client`
      INSERT INTO game.entity_relations (source_instance_id, target_instance_id, relation_type)
      VALUES (${uuid(2)}, ${uuid(1)}, 'located_within')
    `;
  }

  const factsWith = (
    facts: Awaited<ReturnType<typeof store.buildContext>>["playerKnownFacts"],
    claim: string,
    value?: string | number | boolean,
  ) =>
    facts.filter((fact) => fact.claim === claim && (value === undefined || fact.value === value));

  it("includes safe selected-character and inventory facts, current place, and ancestors", async () => {
    await world();
    await player("alice", uuid(10), uuid(2));
    await instance(uuid(11), "item", {
      ownerId: uuid(10),
      condition: 55,
      state: { charges: 2 },
    });

    const context = await store.buildContext("alice");

    expect(context.viewpointId).toBe(uuid(10));
    expect(factsWith(context.playerKnownFacts, "entity.name", "Hero")).toHaveLength(1);
    expect(factsWith(context.playerKnownFacts, "entity.condition", 73)).toHaveLength(1);
    expect(JSON.stringify(context.playerKnownFacts)).not.toContain("privateResource");
    expect(factsWith(context.playerKnownFacts, "current_location", uuid(2))).toHaveLength(1);
    expect(factsWith(context.playerKnownFacts, "location_ancestor", uuid(1))).toHaveLength(1);
    expect(factsWith(context.playerKnownFacts, "owned_entity", uuid(11))).toHaveLength(1);
    expect(JSON.stringify(context.playerKnownFacts)).not.toContain("charges");
    expect(context.playerKnownFacts.every((fact) => fact.visibility === "player_known")).toBe(true);
  });

  it("shows explicitly observed same-room occupants but keeps private state authoritative-hidden", async () => {
    await world();
    await player("alice", uuid(20), uuid(2));
    await player("bob", uuid(21), uuid(2));
    await database.client`
      INSERT INTO game.entity_relations (source_instance_id, target_instance_id, relation_type, parameters)
      VALUES (${uuid(20)}, ${uuid(21)}, 'observed', '{"visibility":"player_known"}')
    `;

    const context = await store.buildContext("alice");

    expect(factsWith(context.playerKnownFacts, "observed_entity", uuid(21))).toHaveLength(1);
    expect(factsWith(context.playerKnownFacts, "observed_entity_name", "Hero")).toHaveLength(1);
    expect(JSON.stringify(context.playerKnownFacts)).not.toContain("privateResource");
    expect(
      factsWith(
        context.authoritativeHiddenFacts,
        "observed_entity_state",
        '{"active":true,"privateResource":4}',
      ),
    ).toHaveLength(1);
    expect(
      context.authoritativeHiddenFacts.every((fact) => fact.visibility === "authoritative_hidden"),
    ).toBe(true);
  });

  it("does not infer observation or relationship knowledge from storage presence", async () => {
    await world();
    await player("alice", uuid(22), uuid(2));
    await player("concealed", uuid(23), uuid(2));
    await database.client`
      INSERT INTO game.entity_relations (source_instance_id, target_instance_id, relation_type, parameters)
      VALUES (${uuid(22)}, ${uuid(23)}, 'secret_patron', '{"identity":"hidden"}')
    `;

    const serialized = JSON.stringify(await store.buildContext("alice"));
    expect(serialized).not.toContain(uuid(23));
    expect(serialized).not.toContain("secret_patron");
    expect(serialized).not.toContain("identity");
  });

  it("does not expose an unrelated player's identity, state, or exact location", async () => {
    await world();
    await instance(uuid(3), "place", { locationId: uuid(1) });
    await player("alice", uuid(30), uuid(2));
    await player("bob", uuid(31), uuid(3));
    await database.client`
      UPDATE game.entity_instances SET state = '{"bobSecret":"classified"}'
      WHERE instance_id = ${uuid(31)}
    `;

    const context = await store.buildContext("alice");
    const serialized = JSON.stringify(context);

    expect(serialized).not.toContain(uuid(31));
    expect(serialized).not.toContain(uuid(3));
    expect(serialized).not.toContain("bobSecret");
  });

  it("includes held information without querying the subject's current location", async () => {
    await world();
    await instance(uuid(3), "place", { locationId: uuid(1) });
    await player("alice", uuid(40), uuid(2));
    await player("bob", uuid(41), uuid(3));
    const eventId = uuid(42);
    await database.client`
      INSERT INTO game.event_ledger (
        event_id, idempotency_key, world_time, event_type, payload
      ) VALUES (${eventId}, 'information-test', now(), 'observation', '{}')
    `;
    await database.client`
      INSERT INTO game.information_assets (
        holder_instance_id, subject_instance_id, content, confidence, truth_status, source_event_id
      ) VALUES (${uuid(40)}, ${uuid(41)}, 'Bob was seen near the docks.', 0.8, 'observation', ${eventId})
    `;

    const context = await store.buildContext("alice");

    expect(
      factsWith(context.playerKnownFacts, "held_information", "Bob was seen near the docks."),
    ).toHaveLength(1);
    expect(factsWith(context.playerKnownFacts, "held_information_confidence", 0.8)).toHaveLength(1);
    expect(
      factsWith(context.playerKnownFacts, "held_information_truth_status", "observation"),
    ).toHaveLength(1);
    expect(factsWith(context.playerKnownFacts, "held_information_asset")).toHaveLength(1);
    expect(factsWith(context.playerKnownFacts, "held_information")[0]?.validity.validFromTurn).toBe(
      1,
    );
    expect(JSON.stringify(context)).not.toContain(uuid(3));
  });

  it("includes relationships involving the viewpoint but excludes unrelated secret relationships", async () => {
    await world();
    await player("alice", uuid(50), uuid(2));
    await player("bob", uuid(51), uuid(2));
    await instance(uuid(52), "item");
    await database.client`
      INSERT INTO game.entity_relations (source_instance_id, target_instance_id, relation_type, parameters)
      VALUES
        (${uuid(50)}, ${uuid(52)}, 'trusted_contact', '{"level":2,"visibility":"player_known"}'),
        (${uuid(50)}, ${uuid(51)}, 'secret_patron', '{"identity":"hidden"}'),
        (${uuid(51)}, ${uuid(52)}, 'secret_patron', '{"identity":"hidden"}')
    `;

    const context = await store.buildContext("alice");

    expect(
      factsWith(context.playerKnownFacts, "relationship.trusted_contact", uuid(52)),
    ).toHaveLength(1);
    expect(JSON.stringify(context)).not.toContain("secret_patron");
    expect(JSON.stringify(context)).not.toContain("identity");
  });

  it("rejects absent or invalid selected characters", async () => {
    await world();
    await expect(store.buildContext("nobody")).rejects.toMatchObject({
      code: "selected_character_not_found",
    });

    await instance(uuid(60), "item", { locationId: uuid(2) });
    await database.client`
      INSERT INTO game.player_characters (user_id, character_instance_id, selected)
      VALUES ('invalid', ${uuid(60)}, true)
    `;
    await expect(store.buildContext("invalid")).rejects.toMatchObject({
      code: "invalid_selected_character",
    });
  });

  it("uses a caller transaction for fresh pre-commit validation", async () => {
    await world();
    await player("alice", uuid(75), uuid(2));

    await expect(
      database.client.begin(async (sql) => {
        await sql`UPDATE game.entity_instances SET condition = 41 WHERE instance_id = ${uuid(75)}`;
        const context = await store.buildContext("alice", sql);
        expect(factsWith(context.playerKnownFacts, "entity.condition", 41)).toHaveLength(1);
        throw new Error("rollback-test");
      }),
    ).rejects.toThrow("rollback-test");

    const afterRollback = await store.buildContext("alice");
    expect(factsWith(afterRollback.playerKnownFacts, "entity.condition", 73)).toHaveLength(1);
  });

  it("returns bounded schema-valid facts with stable IDs across unchanged reads", async () => {
    await world();
    await player("alice", uuid(70), uuid(2));

    const first = await store.buildContext("alice");
    const second = await store.buildContext("alice");

    expect(second).toEqual(first);
    expect(
      first.playerKnownFacts.length + first.authoritativeHiddenFacts.length,
    ).toBeLessThanOrEqual(24);
    for (const fact of [...first.playerKnownFacts, ...first.authoritativeHiddenFacts]) {
      expect(fact.factId).toMatch(/^fact:v1:[a-f0-9]{32}$/);
      expect(fact.viewpointId).toBe(uuid(70));
      expect(fact.validity).toEqual({ state: "valid", validFromTurn: 0 });
      expect(fact.provenance.sourceId).toBeTruthy();
    }
  });

  it("reserves hidden capacity when known candidates are abundant", async () => {
    await world();
    await player("alice", uuid(80), uuid(2));
    for (let index = 81; index <= 90; index += 1) {
      await instance(uuid(index), "item", { ownerId: uuid(80), state: { secret: index } });
    }
    for (let index = 101; index <= 108; index += 1) {
      await instance(uuid(index), "item", { locationId: uuid(2), state: { hidden: index } });
      await database.client`
        INSERT INTO game.entity_relations (source_instance_id, target_instance_id, relation_type, parameters)
        VALUES (${uuid(80)}, ${uuid(index)}, 'observed', '{"visibility":"player_known"}')
      `;
    }
    const eventId = uuid(120);
    await database.client`
      INSERT INTO game.event_ledger (event_id, idempotency_key, world_time, event_type, payload)
      VALUES (${eventId}, 'abundance-information', now(), 'observation', '{}')
    `;
    await database.client`
      INSERT INTO game.information_assets (
        holder_instance_id, content, confidence, truth_status, source_event_id
      ) VALUES (${uuid(80)}, 'A relevant remembered clue.', 1, 'observation', ${eventId})
    `;

    const context = await store.buildContext("alice");
    expect(factsWith(context.playerKnownFacts, "observed_entity").length).toBeGreaterThan(0);
    expect(
      factsWith(context.playerKnownFacts, "held_information", "A relevant remembered clue."),
    ).toHaveLength(1);
    expect(context.playerKnownFacts.length).toBeLessThanOrEqual(16);
    expect(context.authoritativeHiddenFacts.length).toBeGreaterThan(0);
    expect(context.authoritativeHiddenFacts.length).toBeLessThanOrEqual(8);
    expect(
      context.playerKnownFacts.length + context.authoritativeHiddenFacts.length,
    ).toBeLessThanOrEqual(24);
  });
});
