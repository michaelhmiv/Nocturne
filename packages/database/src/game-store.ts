import { randomUUID } from "node:crypto";
import type {
  CharacterSummary,
  CreateCharacterInput,
  RentResidenceResult,
  StarterWorld,
} from "@nocturne/contracts";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";

export const STARTER_WORLD_IDS = {
  city: "10000000-0000-4000-8000-000000000001",
  district: "10000000-0000-4000-8000-000000000002",
  neighborhood: "10000000-0000-4000-8000-000000000003",
  building: "10000000-0000-4000-8000-000000000004",
  residence: "10000000-0000-4000-8000-000000000005",
  alley: "10000000-0000-4000-8000-000000000006",
} as const;

const STARTER_DEFINITIONS = [
  [
    "WORLD-CALDER-CITY",
    "location",
    "Calder City",
    "An Atlantic coastal metropolis shaped by old wealth, port crime, advanced research, and hidden supernatural history.",
  ],
  [
    "WORLD-FOUNDRY-WARD",
    "location",
    "Foundry Ward",
    "A former industrial district of brick factories, rail infrastructure, workshops, and uneven redevelopment.",
  ],
  [
    "WORLD-FOUNDRY-ROW",
    "location",
    "Foundry Row",
    "A dense neighborhood of converted industrial buildings, repair shops, apartments, and active alleys.",
  ],
  [
    "WORLD-ASHDOWN-APARTMENTS",
    "location",
    "Ashdown Apartments",
    "A worn but serviceable brick apartment building overlooking Foundry Row.",
  ],
  [
    "WORLD-ASHDOWN-UNIT-3B",
    "residence",
    "Ashdown Apartments, Unit 3B",
    "A modest apartment with a spare room, ordinary utilities, and limited concealment for unusual equipment.",
  ],
  [
    "WORLD-ASHDOWN-REAR-ALLEY",
    "location",
    "Rear Alley",
    "A service alley behind Ashdown Apartments with dumpsters, fire escapes, delivery access, and inconsistent lighting.",
  ],
] as const;

const STARTER_INSTANCE_IDS = Object.values(STARTER_WORLD_IDS);
const STARTER_REVISION_IDS = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
  "20000000-0000-4000-8000-000000000004",
  "20000000-0000-4000-8000-000000000005",
  "20000000-0000-4000-8000-000000000006",
] as const;

export class PersistentWorldError extends Error {
  constructor(
    readonly code: "not_found" | "forbidden" | "residence_unavailable" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "PersistentWorldError";
  }
}

function asIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

type StarterWorldRow = {
  instance_id: string;
  name: string;
  payload: unknown;
  occupied_by: string | null;
};

export function createPersistentWorldStore(database: ReturnType<typeof createDatabase>) {
  async function seedStarterWorld(): Promise<StarterWorld> {
    await database.client.begin(async (sql) => {
      for (let index = 0; index < STARTER_DEFINITIONS.length; index += 1) {
        const definition = STARTER_DEFINITIONS[index];
        const revisionId = STARTER_REVISION_IDS[index];
        const instanceId = STARTER_INSTANCE_IDS[index];
        if (!definition || !revisionId || !instanceId) {
          throw new Error("Starter world seed constants are incomplete.");
        }
        const [definitionId, definitionType, name, conceptSummary] = definition;
        const locationId = index === 0 ? null : (STARTER_INSTANCE_IDS[index - 1] ?? null);
        if (index > 0 && !locationId) {
          throw new Error("Starter world location constants are incomplete.");
        }
        const extensionPayload =
          definitionId === "WORLD-ASHDOWN-UNIT-3B"
            ? { capacities: { space: 3, power: 2, concealment: 1, security: 1, access: 2 } }
            : {};

        await sql`
          INSERT INTO game.entity_definitions (
            definition_id, definition_type, name, concept_summary, origin_source, lifecycle_status
          ) VALUES (
            ${definitionId}, ${definitionType}, ${name}, ${conceptSummary}, 'world_seed', 'approved'
          ) ON CONFLICT (definition_id) DO NOTHING
        `;
        await sql`
          INSERT INTO game.definition_revisions (
            revision_id, definition_id, schema_version, payload, change_summary
          ) VALUES (
            ${revisionId}, ${definitionId}, 'content-v1',
            ${json({ definitionType, name, conceptSummary, extensionPayload })},
            'Seed Foundry Row starter world'
          ) ON CONFLICT (revision_id) DO NOTHING
        `;
        await sql`
          UPDATE game.entity_definitions
          SET current_revision_id = ${revisionId}, updated_at = now()
          WHERE definition_id = ${definitionId} AND current_revision_id IS DISTINCT FROM ${revisionId}
        `;
        await sql`
          INSERT INTO game.entity_instances (
            instance_id, definition_id, location_id, condition, state
          ) VALUES (
            ${instanceId}, ${definitionId}, ${locationId}, 100,
            ${json(definitionId === "WORLD-ASHDOWN-UNIT-3B" ? { rentable: true } : {})}
          ) ON CONFLICT (instance_id) DO NOTHING
        `;
      }

      for (let index = 1; index < STARTER_INSTANCE_IDS.length; index += 1) {
        const sourceInstanceId = STARTER_INSTANCE_IDS[index];
        const targetInstanceId = STARTER_INSTANCE_IDS[index - 1];
        if (!sourceInstanceId || !targetInstanceId) {
          throw new Error("Starter world relation constants are incomplete.");
        }
        await sql`
          INSERT INTO game.entity_relations (
            source_instance_id, target_instance_id, relation_type
          ) VALUES (
            ${sourceInstanceId}, ${targetInstanceId}, 'located_within'
          ) ON CONFLICT (source_instance_id, target_instance_id, relation_type) DO NOTHING
        `;
      }

      await sql`
        INSERT INTO game.event_ledger (
          event_id, idempotency_key, world_time, event_type, involved_entity_ids, payload
        ) VALUES (
          '30000000-0000-4000-8000-000000000001', 'seed:foundry-row:v1', now(),
          'starter_world_seeded', ${json([...STARTER_INSTANCE_IDS])},
          ${json({ version: 1, neighborhoodId: STARTER_WORLD_IDS.neighborhood })}
        ) ON CONFLICT (idempotency_key) DO NOTHING
      `;
    });
    return getStarterWorld();
  }

  async function getStarterWorld(): Promise<StarterWorld> {
    const rows = (await database.client`
      SELECT i.instance_id, d.name, d.definition_id,
             r.payload,
             o.character_instance_id AS occupied_by
      FROM game.entity_instances i
      JOIN game.entity_definitions d ON d.definition_id = i.definition_id
      JOIN game.definition_revisions r ON r.revision_id = d.current_revision_id
      LEFT JOIN game.residence_occupancies o
        ON o.residence_instance_id = i.instance_id AND o.status = 'active'
      WHERE i.instance_id = ANY(${database.client.array(STARTER_INSTANCE_IDS, 2950)})
    `) as StarterWorldRow[];
    const byId = new Map(rows.map((row) => [String(row.instance_id), row]));
    const pick = (id: string) => {
      const row = byId.get(id);
      if (!row) throw new PersistentWorldError("not_found", "Starter world has not been seeded.");
      return row;
    };
    const residence = pick(STARTER_WORLD_IDS.residence);
    const payload = residence.payload as {
      extensionPayload?: { capacities?: Record<string, number> };
    };
    return {
      city: { id: STARTER_WORLD_IDS.city, name: String(pick(STARTER_WORLD_IDS.city).name) },
      district: {
        id: STARTER_WORLD_IDS.district,
        name: String(pick(STARTER_WORLD_IDS.district).name),
      },
      neighborhood: {
        id: STARTER_WORLD_IDS.neighborhood,
        name: String(pick(STARTER_WORLD_IDS.neighborhood).name),
      },
      building: {
        id: STARTER_WORLD_IDS.building,
        name: String(pick(STARTER_WORLD_IDS.building).name),
      },
      residence: {
        id: STARTER_WORLD_IDS.residence,
        name: String(residence.name),
        occupiedByCharacterId: residence.occupied_by ? String(residence.occupied_by) : null,
        capacities: payload.extensionPayload?.capacities ?? {},
      },
      alley: { id: STARTER_WORLD_IDS.alley, name: String(pick(STARTER_WORLD_IDS.alley).name) },
    };
  }

  async function createCharacter(
    userId: string,
    input: CreateCharacterInput,
    idempotencyKey: string,
  ): Promise<CharacterSummary> {
    return database.client.begin(async (sql) => {
      const existing = await sql`
        SELECT payload FROM game.event_ledger WHERE idempotency_key = ${idempotencyKey}
      `;
      if (existing[0]?.payload) {
        const characterId = String((existing[0].payload as Record<string, unknown>).characterId);
        const character = await getCharacter(userId, characterId);
        if (!character)
          throw new PersistentWorldError(
            "conflict",
            "Idempotency key belongs to an unavailable result.",
          );
        return character;
      }

      const definitionId = `CHAR-${randomUUID()}`;
      const revisionId = randomUUID();
      const characterId = randomUUID();
      const eventId = randomUUID();
      const createdAt = new Date().toISOString();
      const payload = {
        definitionType: "character",
        name: input.name,
        conceptSummary: input.conceptSummary,
        playerFantasy: input.conceptSummary,
        noveltyLevel: 0,
        originSource: input.originSource,
        traits: Object.entries(input.qualities).map(([name, parameters]) => ({
          name,
          type: "descriptive",
          parameters:
            typeof parameters === "object" && parameters !== null
              ? parameters
              : { value: parameters },
        })),
        effects: [],
        modes: [],
        requirements: [],
        costs: [],
        limitations: [],
        risks: [],
        signatures: [],
        counters: [],
        relationships: [],
        acquisitionPath: { type: "immediate", parameters: {} },
        extensionPayload: { character: { qualities: input.qualities } },
        status: "approved",
      };

      await sql`
        INSERT INTO game.entity_definitions (
          definition_id, definition_type, name, concept_summary, origin_source, lifecycle_status
        ) VALUES (
          ${definitionId}, 'character', ${input.name}, ${input.conceptSummary}, ${input.originSource}, 'approved'
        )
      `;
      await sql`
        INSERT INTO game.definition_revisions (
          revision_id, definition_id, payload, change_summary
        ) VALUES (${revisionId}, ${definitionId}, ${json(payload)}, 'Create player character')
      `;
      await sql`
        UPDATE game.entity_definitions SET current_revision_id = ${revisionId}, updated_at = now()
        WHERE definition_id = ${definitionId}
      `;
      await sql`
        INSERT INTO game.entity_instances (
          instance_id, definition_id, location_id, condition, state
        ) VALUES (${characterId}, ${definitionId}, ${STARTER_WORLD_IDS.neighborhood}, 100, ${json({
          active: true,
          skills: {},
          cashOnPerson: 50_000, // $500 starter — market usable without SQL
          heat: 0,
          warrant: false,
          factionStanding: {},
        })})
      `;
      const hasSelected = await sql`
        SELECT 1 FROM game.player_characters WHERE user_id = ${userId} AND selected LIMIT 1
      `;
      await sql`
        INSERT INTO game.player_characters (user_id, character_instance_id, selected)
        VALUES (${userId}, ${characterId}, ${hasSelected.length === 0})
      `;
      await sql`
        INSERT INTO game.event_ledger (
          event_id, idempotency_key, world_time, event_type, involved_entity_ids, payload
        ) VALUES (
          ${eventId}, ${idempotencyKey}, now(), 'character_created', ${json([characterId])},
          ${json({ characterId, definitionId, userId, createdAt })}
        )
      `;
      await sql`
        UPDATE game.entity_instances SET created_event_id = ${eventId} WHERE instance_id = ${characterId}
      `;

      const starterResidenceRows = await sql`
        SELECT residence_id, event_id, already_rented
        FROM game.provision_starter_residence(
          ${userId},
          ${characterId},
          ${`starter-residence:${characterId}`}
        )
      `;
      const starterResidence = starterResidenceRows[0];
      if (!starterResidence?.residence_id) {
        throw new PersistentWorldError(
          "conflict",
          "Starter housing could not be provisioned for the new character.",
        );
      }
      const residenceId = String(starterResidence.residence_id);
      const residenceRows = await sql`
        SELECT d.name
        FROM game.entity_instances i
        JOIN game.entity_definitions d ON d.definition_id = i.definition_id
        WHERE i.instance_id = ${residenceId}
        LIMIT 1
      `;
      const residenceName = residenceRows[0]?.name ? String(residenceRows[0].name) : null;

      return {
        characterId,
        definitionId,
        name: input.name,
        conceptSummary: input.conceptSummary,
        originSource: input.originSource,
        selected: hasSelected.length === 0,
        locationId: residenceId,
        residenceId,
        residenceName,
        createdAt,
        cashOnPerson: 50_000,
        heat: 0,
        warrant: false,
        status: "active",
        factionStanding: {},
        skills: {},
        inventory: [],
      };
    });
  }

  async function listCharacters(userId: string): Promise<CharacterSummary[]> {
    const rows = await database.client`
      SELECT pc.character_instance_id, pc.selected, pc.created_at,
             d.definition_id, d.name, d.concept_summary, d.origin_source,
             i.location_id, i.state, o.residence_instance_id, rd.name AS residence_name
      FROM game.player_characters pc
      JOIN game.entity_instances i ON i.instance_id = pc.character_instance_id
      JOIN game.entity_definitions d ON d.definition_id = i.definition_id
      LEFT JOIN game.residence_occupancies o
        ON o.character_instance_id = i.instance_id AND o.status = 'active'
      LEFT JOIN game.entity_instances ri ON ri.instance_id = o.residence_instance_id
      LEFT JOIN game.entity_definitions rd ON rd.definition_id = ri.definition_id
      WHERE pc.user_id = ${userId}
      ORDER BY pc.created_at ASC
    `;
    return rows.map((row) => {
      const state = (row.state as Record<string, unknown>) || {};
      const skills = (state.skills as Record<string, number>) || {};
      const factions = (state.factionStanding as Record<string, number>) || {};
      return {
        characterId: String(row.character_instance_id),
        definitionId: String(row.definition_id),
        name: String(row.name),
        conceptSummary: String(row.concept_summary),
        originSource: row.origin_source ? String(row.origin_source) : null,
        selected: Boolean(row.selected),
        locationId: row.location_id ? String(row.location_id) : null,
        residenceId: row.residence_instance_id ? String(row.residence_instance_id) : null,
        residenceName: row.residence_name ? String(row.residence_name) : null,
        createdAt: asIso(row.created_at as Date),
        cashOnPerson: Number(state.cashOnPerson ?? 0),
        heat: Number(state.heat ?? 0),
        warrant: Boolean(state.warrant),
        status: String(state.status || "active"),
        factionStanding: factions,
        skills,
        inventory: Array.isArray(state.inventory) ? state.inventory : [],
      };
    });
  }

  async function getCharacter(
    userId: string,
    characterId: string,
  ): Promise<CharacterSummary | null> {
    const characters = await listCharacters(userId);
    return characters.find((character) => character.characterId === characterId) ?? null;
  }

  async function selectCharacter(userId: string, characterId: string): Promise<CharacterSummary> {
    await database.client.begin(async (sql) => {
      const controlled = await sql`
        SELECT 1 FROM game.player_characters
        WHERE user_id = ${userId} AND character_instance_id = ${characterId}
      `;
      if (controlled.length === 0)
        throw new PersistentWorldError("forbidden", "Character is not controlled by this account.");
      await sql`UPDATE game.player_characters SET selected = false WHERE user_id = ${userId}`;
      await sql`
        UPDATE game.player_characters SET selected = true
        WHERE user_id = ${userId} AND character_instance_id = ${characterId}
      `;
    });
    const selected = await getCharacter(userId, characterId);
    if (!selected) throw new PersistentWorldError("not_found", "Character not found.");
    return selected;
  }

  async function rentStarterResidence(
    userId: string,
    characterId: string,
    idempotencyKey: string,
  ): Promise<RentResidenceResult> {
    return database.client.begin(async (sql) => {
      const controlled = await sql`
        SELECT 1 FROM game.player_characters
        WHERE user_id = ${userId} AND character_instance_id = ${characterId}
      `;
      if (controlled.length === 0) {
        throw new PersistentWorldError("forbidden", "Character is not controlled by this account.");
      }

      const provisioningKey = idempotencyKey.startsWith("starter-residence:")
        ? idempotencyKey
        : `starter-residence:${characterId}`;
      const rows = await sql`
        SELECT residence_id, event_id, already_rented
        FROM game.provision_starter_residence(${userId}, ${characterId}, ${provisioningKey})
      `;
      const row = rows[0];
      if (!row?.residence_id || !row?.event_id) {
        throw new PersistentWorldError("conflict", "Starter housing could not be provisioned.");
      }
      return {
        characterId,
        residenceId: String(row.residence_id),
        eventId: String(row.event_id),
        alreadyRented: Boolean(row.already_rented),
      };
    });
  }

  return {
    seedStarterWorld,
    getStarterWorld,
    createCharacter,
    listCharacters,
    getCharacter,
    selectCharacter,
    rentStarterResidence,
  };
}

export type PersistentWorldStore = ReturnType<typeof createPersistentWorldStore>;
