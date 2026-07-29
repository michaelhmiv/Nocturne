import { createHash } from "node:crypto";
import {
  FactReferenceSchema,
  MAX_CONVERSATION_FACTS,
  type FactReference,
} from "@nocturne/contracts";
import type { TransactionSql } from "postgres";
import type { createDatabase } from "./index.js";

const MAX_TEXT = 2_000;
const MAX_PLAYER_KNOWN_FACTS = 16;
const MAX_HIDDEN_FACTS = MAX_CONVERSATION_FACTS - MAX_PLAYER_KNOWN_FACTS;
type PublicFact = Extract<FactReference, { visibility: "player_known" }>;
type HiddenFact = Extract<FactReference, { visibility: "authoritative_hidden" }>;
type Visibility = FactReference["visibility"];
type Provenance = FactReference["provenance"]["kind"];

type EntityRow = {
  instance_id: string;
  definition_type: string;
  name: string;
  current_revision_id: string | null;
  location_id: string | null;
  condition: number;
  state: unknown;
};

type RelationRow = {
  relation_id: string;
  source_instance_id: string;
  target_instance_id: string;
  relation_type: string;
  parameters: unknown;
};

type InformationRow = {
  information_id: string;
  content: string;
  confidence: string;
  truth_status: string;
  source_event_id: string;
  valid_from_turn: number;
};

export class AuthoritativeContextError extends Error {
  constructor(
    readonly code: "selected_character_not_found" | "invalid_selected_character",
    message: string,
  ) {
    super(message);
    this.name = "AuthoritativeContextError";
  }
}

const bounded = (value: string) => value.slice(0, MAX_TEXT);
const stateValue = (value: unknown) => {
  if (typeof value !== "string") return bounded(JSON.stringify(value) ?? "null");
  try {
    return bounded(JSON.stringify(JSON.parse(value)));
  } catch {
    return bounded(value);
  }
};

export function createAuthoritativeContextStore(database: ReturnType<typeof createDatabase>) {
  function fact(
    viewpointId: string,
    identity: string,
    claim: string,
    value: string | number | boolean,
    visibility: Visibility,
    provenance: Provenance,
    sourceId: string,
    validFromTurn = 0,
  ): FactReference {
    const boundedClaim = bounded(claim);
    const boundedValue = typeof value === "string" ? bounded(value) : value;
    const digest = createHash("sha256")
      .update(
        JSON.stringify([viewpointId, identity, boundedClaim, boundedValue, visibility, sourceId]),
      )
      .digest("hex")
      .slice(0, 32);
    return FactReferenceSchema.parse({
      factId: `fact:v1:${digest}`,
      claim: boundedClaim,
      value: boundedValue,
      validity: { state: "valid", validFromTurn },
      provenance: { kind: provenance, sourceId },
      viewpointId,
      visibility,
    });
  }

  type Context = {
    viewpointId: string;
    playerKnownFacts: PublicFact[];
    authoritativeHiddenFacts: HiddenFact[];
  };

  async function buildContextWith(sql: TransactionSql, userId: string): Promise<Context> {
    const selectedRows = (await sql`
        SELECT i.instance_id, i.location_id, i.condition,
               d.definition_type, d.name, d.current_revision_id
        FROM game.player_characters pc
        JOIN game.entity_instances i ON i.instance_id = pc.character_instance_id
        JOIN game.entity_definitions d ON d.definition_id = i.definition_id
        WHERE pc.user_id = ${userId} AND pc.selected
      `) as EntityRow[];
    const selected = selectedRows[0];
    if (!selected) {
      throw new AuthoritativeContextError(
        "selected_character_not_found",
        "No selected character exists for this account.",
      );
    }
    if (selected.definition_type !== "character") {
      throw new AuthoritativeContextError(
        "invalid_selected_character",
        "The selected controlled entity is not a character.",
      );
    }

    const viewpointId = selected.instance_id;
    const locations = selected.location_id
      ? ((await sql`
            WITH RECURSIVE ancestors AS (
              SELECT i.instance_id, d.name, d.current_revision_id
              FROM game.entity_instances i
              JOIN game.entity_definitions d ON d.definition_id = i.definition_id
              WHERE i.instance_id = ${selected.location_id}
              UNION
              SELECT parent.instance_id, definition.name, definition.current_revision_id
              FROM ancestors child
              JOIN game.entity_relations relation
                ON relation.source_instance_id = child.instance_id
               AND relation.relation_type = 'located_within'
              JOIN game.entity_instances parent
                ON parent.instance_id = relation.target_instance_id
              JOIN game.entity_definitions definition
                ON definition.definition_id = parent.definition_id
            )
            SELECT instance_id, name, current_revision_id
            FROM ancestors
            ORDER BY instance_id
            LIMIT 8
          `) as Pick<EntityRow, "instance_id" | "name" | "current_revision_id">[])
      : [];
    const owned = (await sql`
        SELECT i.instance_id, i.location_id, i.condition,
               d.definition_type, d.name, d.current_revision_id
        FROM game.entity_instances i
        JOIN game.entity_definitions d ON d.definition_id = i.definition_id
        WHERE (i.owner_id = ${viewpointId} OR i.controller_id = ${viewpointId})
          AND i.instance_id <> ${viewpointId}
        ORDER BY i.instance_id
        LIMIT 8
      `) as EntityRow[];
    const observed = selected.location_id
      ? ((await sql`
            SELECT i.instance_id, i.location_id, i.condition, LEFT(i.state::text, 2000) AS state,
                   d.definition_type, d.name, d.current_revision_id
            FROM game.entity_instances i
            JOIN game.entity_definitions d ON d.definition_id = i.definition_id
            WHERE i.location_id = ${selected.location_id}
              AND i.instance_id <> ${viewpointId}
              AND i.owner_id IS DISTINCT FROM ${viewpointId}
              AND i.controller_id IS DISTINCT FROM ${viewpointId}
              AND EXISTS (
                SELECT 1 FROM game.entity_relations observation
                WHERE observation.source_instance_id = ${viewpointId}
                  AND observation.target_instance_id = i.instance_id
                  AND observation.relation_type = 'observed'
                  AND observation.parameters ->> 'visibility' = 'player_known'
              )
            ORDER BY i.instance_id
            LIMIT 8
          `) as EntityRow[])
      : [];
    const relationships = (await sql`
        SELECT relation_id, source_instance_id, target_instance_id, relation_type, parameters
        FROM game.entity_relations
        WHERE (source_instance_id = ${viewpointId} OR target_instance_id = ${viewpointId})
          AND parameters ->> 'visibility' = 'player_known'
          AND relation_type <> 'observed'
        ORDER BY relation_id
        LIMIT 8
      `) as RelationRow[];
    const information = (await sql`
        WITH held AS (
          SELECT asset.information_id, asset.content, asset.confidence,
                 asset.truth_status, asset.source_event_id, source.created_at AS source_created_at
          FROM game.information_assets asset
          JOIN game.event_ledger source ON source.event_id = asset.source_event_id
          WHERE asset.holder_instance_id = ${viewpointId}
          ORDER BY asset.information_id
          LIMIT 8
        )
        SELECT held.information_id, held.content, held.confidence::text AS confidence,
               held.truth_status, held.source_event_id,
               (SELECT COUNT(*)::int FROM game.event_ledger ledger
                WHERE ledger.created_at <= held.source_created_at) AS valid_from_turn
        FROM held
        ORDER BY held.information_id
      `) as InformationRow[];

    const known: PublicFact[] = [];
    const hidden: HiddenFact[] = [];
    const addKnown = (...args: Parameters<typeof fact>) => {
      if (known.length < MAX_PLAYER_KNOWN_FACTS) known.push(fact(...args) as PublicFact);
    };
    const addKnownUntil = (limit: number, ...args: Parameters<typeof fact>) => {
      if (known.length < limit) known.push(fact(...args) as PublicFact);
    };
    const addHidden = (...args: Parameters<typeof fact>) => {
      if (hidden.length < MAX_HIDDEN_FACTS) hidden.push(fact(...args) as HiddenFact);
    };
    const selectedSource = selected.current_revision_id ?? viewpointId;

    addKnown(
      viewpointId,
      viewpointId,
      "entity.name",
      selected.name,
      "player_known",
      "content_definition",
      selectedSource,
    );
    addKnown(
      viewpointId,
      viewpointId,
      "entity.condition",
      selected.condition,
      "player_known",
      "character_state",
      viewpointId,
    );

    if (selected.location_id) {
      addKnown(
        viewpointId,
        viewpointId,
        "current_location",
        selected.location_id,
        "player_known",
        "world_state",
        viewpointId,
      );
    }
    for (const location of locations) {
      const source = location.current_revision_id ?? location.instance_id;
      addKnown(
        viewpointId,
        `location:${location.instance_id}`,
        location.instance_id === selected.location_id
          ? "current_location_name"
          : "location_ancestor",
        location.instance_id === selected.location_id ? location.name : location.instance_id,
        "player_known",
        "world_state",
        source,
      );
    }
    for (const entity of owned) {
      const source = entity.current_revision_id ?? entity.instance_id;
      addKnownUntil(
        10,
        viewpointId,
        entity.instance_id,
        "owned_entity",
        entity.instance_id,
        "player_known",
        "world_state",
        entity.instance_id,
      );
      addKnownUntil(
        10,
        viewpointId,
        entity.instance_id,
        "owned_entity_name",
        entity.name,
        "player_known",
        "content_definition",
        source,
      );
      addKnownUntil(
        10,
        viewpointId,
        entity.instance_id,
        "owned_entity_condition",
        entity.condition,
        "player_known",
        "world_state",
        entity.instance_id,
      );
    }
    for (const entity of observed) {
      const source = entity.current_revision_id ?? entity.instance_id;
      addKnownUntil(
        12,
        viewpointId,
        entity.instance_id,
        "observed_entity",
        entity.instance_id,
        "player_known",
        "world_state",
        entity.instance_id,
      );
      addKnownUntil(
        12,
        viewpointId,
        entity.instance_id,
        "observed_entity_name",
        entity.name,
        "player_known",
        "content_definition",
        source,
      );
      addHidden(
        viewpointId,
        entity.instance_id,
        "observed_entity_condition",
        entity.condition,
        "authoritative_hidden",
        "character_state",
        entity.instance_id,
      );
      addHidden(
        viewpointId,
        entity.instance_id,
        "observed_entity_state",
        stateValue(entity.state),
        "authoritative_hidden",
        "character_state",
        entity.instance_id,
      );
    }
    for (const relation of relationships) {
      const otherId =
        relation.source_instance_id === viewpointId
          ? relation.target_instance_id
          : relation.source_instance_id;
      addKnownUntil(
        14,
        viewpointId,
        relation.relation_id,
        `relationship.${relation.relation_type}`,
        otherId,
        "player_known",
        "world_state",
        relation.relation_id,
      );
    }
    for (const asset of information) {
      addKnown(
        viewpointId,
        asset.information_id,
        "held_information",
        asset.content,
        "player_known",
        "prior_event",
        asset.source_event_id,
        asset.valid_from_turn,
      );
      addKnown(
        viewpointId,
        asset.information_id,
        "held_information_confidence",
        Number(asset.confidence),
        "player_known",
        "prior_event",
        asset.source_event_id,
        asset.valid_from_turn,
      );
      addKnown(
        viewpointId,
        asset.information_id,
        "held_information_truth_status",
        asset.truth_status,
        "player_known",
        "prior_event",
        asset.source_event_id,
        asset.valid_from_turn,
      );
      addKnown(
        viewpointId,
        asset.information_id,
        "held_information_asset",
        asset.information_id,
        "player_known",
        "prior_event",
        asset.source_event_id,
        asset.valid_from_turn,
      );
    }

    const playerKnownFacts = known;
    const authoritativeHiddenFacts = hidden;
    return { viewpointId, playerKnownFacts, authoritativeHiddenFacts };
  }

  async function buildContext(userId: string, transaction?: TransactionSql): Promise<Context> {
    return transaction
      ? buildContextWith(transaction, userId)
      : database.client.begin((sql) => buildContextWith(sql, userId));
  }

  return { buildContext };
}

export type AuthoritativeContextStore = ReturnType<typeof createAuthoritativeContextStore>;
