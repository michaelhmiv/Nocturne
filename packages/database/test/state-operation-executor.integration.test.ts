import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  StateOperationExecutorError,
  createAuthoritativeContextStore,
  createDatabase,
  executeConversationStateOperations,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const baseUrl = process.env.DATABASE_URL;
const describePostgres = baseUrl ? describe : describe.skip;

function uuid(value: number) {
  return `00000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
}

describePostgres("conversation state operation executor (PostgreSQL)", () => {
  const databaseName = `nocturne_operations_${process.pid}_${Date.now()}`;
  let databaseUrl: string;
  let database: ReturnType<typeof createDatabase>;

  beforeAll(async () => {
    const adminUrl = new URL(baseUrl!);
    adminUrl.pathname = "/postgres";
    const admin = postgres(adminUrl.toString(), { max: 1 });
    await admin`CREATE DATABASE ${admin(databaseName)} TEMPLATE template0`;
    await admin.end();

    const testUrl = new URL(baseUrl!);
    testUrl.pathname = `/${databaseName}`;
    databaseUrl = testUrl.toString();
    await execFileAsync("pnpm", ["exec", "tsx", "src/migrate.ts"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
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
    await database.client`TRUNCATE game.entity_definitions, game.conversations CASCADE`;
  });

  async function setupTurn() {
    const originId = uuid(1);
    const destinationId = uuid(2);
    const characterId = uuid(3);
    const subjectId = uuid(4);
    const conversationId = randomUUID();
    const turnId = randomUUID();
    await database.client`
      INSERT INTO game.entity_definitions
        (definition_id, definition_type, name, concept_summary, lifecycle_status)
      VALUES
        ('operation-location', 'location', 'Place', 'A test place.', 'approved'),
        ('operation-character', 'character', 'Hero', 'A test character.', 'approved'),
        ('operation-subject', 'npc', 'Witness', 'A test witness.', 'approved')
    `;
    await database.client`
      INSERT INTO game.entity_instances (instance_id, definition_id, location_id)
      VALUES
        (${originId}, 'operation-location', NULL),
        (${destinationId}, 'operation-location', NULL),
        (${characterId}, 'operation-character', ${originId}),
        (${subjectId}, 'operation-subject', ${originId})
    `;
    await database.client`
      INSERT INTO game.player_characters (user_id, character_instance_id, selected)
      VALUES ('alice', ${characterId}, true)
    `;
    await database.client`
      INSERT INTO game.entity_relations (
        source_instance_id, target_instance_id, relation_type, parameters
      ) VALUES
        (${characterId}, ${destinationId}, 'can_enter', '{"visibility":"player_known"}'),
        (${characterId}, ${subjectId}, 'observed', '{"visibility":"player_known"}')
    `;
    await database.client`
      INSERT INTO game.conversations (conversation_id, user_id) VALUES (${conversationId}, 'alice')
    `;
    await database.client`
      INSERT INTO game.conversation_turns
        (turn_id, conversation_id, user_id, idempotency_key, request_hash, request)
      VALUES (${turnId}, ${conversationId}, 'alice', 'operation-key', 'hash', '{"message":"Move"}')
    `;
    const context = await createAuthoritativeContextStore(database).buildContext("alice");
    const locationFact = context.playerKnownFacts.find(
      (fact) => fact.claim === "current_location",
    )!;
    const destinationFact = context.playerKnownFacts.find(
      (fact) => fact.claim === "relationship.can_enter",
    )!;
    const subjectFact = context.playerKnownFacts.find((fact) => fact.claim === "observed_entity")!;
    return {
      originId,
      destinationId,
      characterId,
      subjectId,
      turnId,
      locationFact,
      destinationFact,
      subjectFact,
    };
  }

  it("applies ordered supported operations and appends their event atomically", async () => {
    const {
      destinationId,
      characterId,
      subjectId,
      turnId,
      locationFact,
      destinationFact,
      subjectFact,
    } = await setupTurn();
    const eventId = randomUUID();

    const input = {
      userId: "alice",
      viewpointId: characterId,
      turnId,
      eventId,
      declaredFactIds: [locationFact.factId, destinationFact.factId, subjectFact.factId],
      operations: [
        {
          type: "move_entity" as const,
          entityId: characterId,
          locationId: destinationId,
          preconditionFactIds: [locationFact.factId, destinationFact.factId],
        },
        {
          type: "create_information_asset" as const,
          holderId: characterId,
          subjectId,
          content: "The witness saw the move.",
          confidenceBasisPoints: 8_500,
          truthStatus: "observation" as const,
          preconditionFactIds: [locationFact.factId, subjectFact.factId],
        },
      ],
    };
    await expect(executeConversationStateOperations(database, input)).resolves.toEqual({ eventId });
    await expect(executeConversationStateOperations(database, input)).resolves.toEqual({ eventId });

    const [instance] = await database.client`
      SELECT location_id FROM game.entity_instances WHERE instance_id = ${characterId}
    `;
    const [information] = await database.client`
      SELECT holder_instance_id, subject_instance_id, content, confidence, source_event_id
      FROM game.information_assets
    `;
    const [event] = await database.client`
      SELECT event_type, payload FROM game.event_ledger WHERE event_id = ${eventId}
    `;
    expect(instance?.location_id).toBe(destinationId);
    expect(information).toMatchObject({
      holder_instance_id: characterId,
      subject_instance_id: subjectId,
      content: "The witness saw the move.",
      confidence: "0.8500",
      source_event_id: eventId,
    });
    expect(event).toMatchObject({
      event_type: "conversation_state_operations_applied",
      payload: { turnId },
    });
  });

  it("rolls back earlier operations when a later target is unauthorized", async () => {
    const { originId, destinationId, characterId, turnId, locationFact, destinationFact } =
      await setupTurn();

    await expect(
      executeConversationStateOperations(database, {
        userId: "alice",
        viewpointId: characterId,
        turnId,
        eventId: randomUUID(),
        declaredFactIds: [locationFact.factId, destinationFact.factId],
        operations: [
          {
            type: "move_entity",
            entityId: characterId,
            locationId: destinationId,
            preconditionFactIds: [locationFact.factId, destinationFact.factId],
          },
          {
            type: "create_information_asset",
            holderId: characterId,
            subjectId: uuid(999),
            content: "Must not persist.",
            confidenceBasisPoints: 8_500,
            truthStatus: "observation",
            preconditionFactIds: [locationFact.factId],
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "unmet_precondition",
    } satisfies Partial<StateOperationExecutorError>);

    const [instance] = await database.client`
      SELECT location_id FROM game.entity_instances WHERE instance_id = ${characterId}
    `;
    const [{ count }] = await database.client`SELECT count(*)::int AS count FROM game.event_ledger`;
    expect(instance?.location_id).toBe(originId);
    expect(count).toBe(0);
  });

  it("rejects a movement destination that is not cited by a current fact", async () => {
    const { destinationId, characterId, turnId, locationFact } = await setupTurn();

    await expect(
      executeConversationStateOperations(database, {
        userId: "alice",
        viewpointId: characterId,
        turnId,
        eventId: randomUUID(),
        declaredFactIds: [locationFact.factId],
        operations: [
          {
            type: "move_entity",
            entityId: characterId,
            locationId: destinationId,
            preconditionFactIds: [locationFact.factId],
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "unmet_precondition",
    } satisfies Partial<StateOperationExecutorError>);
  });

  it("does not treat UUID-valued information content as an entity citation", async () => {
    const { destinationId, characterId, turnId, locationFact } = await setupTurn();
    const sourceEventId = randomUUID();
    await database.client`
      INSERT INTO game.event_ledger (
        event_id, idempotency_key, world_time, event_type, involved_entity_ids, payload
      ) VALUES (${sourceEventId}, ${`fixture:${sourceEventId}`}, now(), 'fixture', '[]', '{}')
    `;
    await database.client`
      INSERT INTO game.information_assets (
        information_id, holder_instance_id, content, confidence, truth_status, source_event_id
      ) VALUES (
        ${randomUUID()}, ${characterId}, ${destinationId}, 0.8, 'observation', ${sourceEventId}
      )
    `;
    const context = await createAuthoritativeContextStore(database).buildContext("alice");
    const informationFact = context.playerKnownFacts.find(
      (fact) => fact.claim === "held_information" && fact.value === destinationId,
    )!;

    await expect(
      executeConversationStateOperations(database, {
        userId: "alice",
        viewpointId: characterId,
        turnId,
        eventId: randomUUID(),
        declaredFactIds: [locationFact.factId, informationFact.factId],
        operations: [
          {
            type: "move_entity",
            entityId: characterId,
            locationId: destinationId,
            preconditionFactIds: [locationFact.factId, informationFact.factId],
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "unmet_precondition",
    } satisfies Partial<StateOperationExecutorError>);
  });

  it("does not treat relationship knowledge alone as movement authorization", async () => {
    const { destinationId, characterId, turnId, locationFact } = await setupTurn();
    await database.client`
      INSERT INTO game.entity_relations (
        source_instance_id, target_instance_id, relation_type, parameters
      ) VALUES (
        ${characterId}, ${destinationId}, 'knows', '{"visibility":"player_known"}'
      )
    `;
    const context = await createAuthoritativeContextStore(database).buildContext("alice");
    const relationshipFact = context.playerKnownFacts.find(
      (fact) => fact.claim === "relationship.knows" && fact.value === destinationId,
    )!;

    await expect(
      executeConversationStateOperations(database, {
        userId: "alice",
        viewpointId: characterId,
        turnId,
        eventId: randomUUID(),
        declaredFactIds: [locationFact.factId, relationshipFact.factId],
        operations: [
          {
            type: "move_entity",
            entityId: characterId,
            locationId: destinationId,
            preconditionFactIds: [locationFact.factId, relationshipFact.factId],
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "unmet_precondition",
    } satisfies Partial<StateOperationExecutorError>);
  });

  it("rejects an information subject that is not cited by a current fact", async () => {
    const { characterId, subjectId, turnId, locationFact } = await setupTurn();

    await expect(
      executeConversationStateOperations(database, {
        userId: "alice",
        viewpointId: characterId,
        turnId,
        eventId: randomUUID(),
        declaredFactIds: [locationFact.factId],
        operations: [
          {
            type: "create_information_asset",
            holderId: characterId,
            subjectId,
            content: "Uncited subject.",
            confidenceBasisPoints: 8_500,
            truthStatus: "observation",
            preconditionFactIds: [locationFact.factId],
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "unmet_precondition",
    } satisfies Partial<StateOperationExecutorError>);
  });

  it("rejects stale facts when mutable state changes while execution waits on a lock", async () => {
    const { destinationId, characterId, turnId, locationFact, destinationFact } = await setupTurn();
    const blocker = postgres(databaseUrl, { max: 1 });
    const adminUrl = new URL(baseUrl!);
    adminUrl.pathname = "/postgres";
    const monitor = postgres(adminUrl.toString(), { max: 1 });
    let execution!: ReturnType<typeof executeConversationStateOperations>;

    try {
      await blocker.begin(async (sql) => {
        await sql`SELECT 1 FROM game.entity_instances WHERE instance_id = ${characterId} FOR UPDATE`;
        execution = executeConversationStateOperations(database, {
          userId: "alice",
          viewpointId: characterId,
          turnId,
          eventId: randomUUID(),
          declaredFactIds: [locationFact.factId, destinationFact.factId],
          operations: [
            {
              type: "move_entity",
              entityId: characterId,
              locationId: destinationId,
              preconditionFactIds: [locationFact.factId, destinationFact.factId],
            },
          ],
        });
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const [{ count }] = await monitor`
            SELECT count(*)::int AS count
            FROM pg_stat_activity
            WHERE datname = ${databaseName} AND wait_event_type = 'Lock'
          `;
          if (count > 0) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        await sql`
          UPDATE game.entity_instances
          SET location_id = ${destinationId}
          WHERE instance_id = ${characterId}
        `;
      });

      await expect(execution).rejects.toMatchObject({
        code: "unmet_precondition",
      } satisfies Partial<StateOperationExecutorError>);
    } finally {
      await blocker.end({ timeout: 5 });
      await monitor.end({ timeout: 5 });
    }
  });

  it("rejects a cited movement authorization deleted while execution waits", async () => {
    const { destinationId, characterId, turnId, locationFact, destinationFact } = await setupTurn();
    const blocker = postgres(databaseUrl, { max: 1 });
    const adminUrl = new URL(baseUrl!);
    adminUrl.pathname = "/postgres";
    const monitor = postgres(adminUrl.toString(), { max: 1 });
    let execution!: ReturnType<typeof executeConversationStateOperations>;

    try {
      await blocker.begin(async (sql) => {
        await sql`
          SELECT 1
          FROM game.entity_relations
          WHERE source_instance_id = ${characterId}
            AND target_instance_id = ${destinationId}
            AND relation_type = 'can_enter'
          FOR UPDATE
        `;
        execution = executeConversationStateOperations(database, {
          userId: "alice",
          viewpointId: characterId,
          turnId,
          eventId: randomUUID(),
          declaredFactIds: [locationFact.factId, destinationFact.factId],
          operations: [
            {
              type: "move_entity",
              entityId: characterId,
              locationId: destinationId,
              preconditionFactIds: [locationFact.factId, destinationFact.factId],
            },
          ],
        });
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt += 1) {
          const [{ count }] = await monitor`
            SELECT count(*)::int AS count
            FROM pg_stat_activity
            WHERE datname = ${databaseName} AND wait_event_type = 'Lock'
          `;
          if (count > 0) {
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        await sql`
          DELETE FROM game.entity_relations
          WHERE source_instance_id = ${characterId}
            AND target_instance_id = ${destinationId}
            AND relation_type = 'can_enter'
        `;
      });

      await expect(execution).rejects.toMatchObject({
        code: "unmet_precondition",
      } satisfies Partial<StateOperationExecutorError>);
    } finally {
      await blocker.end({ timeout: 5 });
      await monitor.end({ timeout: 5 });
    }
  });
});
