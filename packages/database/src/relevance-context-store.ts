import { createHash, randomUUID } from "node:crypto";
import {
  RelevanceCompiledContextSchema,
  RelevanceContextFactSchema,
  type ContextInclusionReason,
  type RelevanceCompiledContext,
  type RelevanceContextFact,
} from "@nocturne/contracts";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";
import type { WorldScope } from "./world-store.js";

export const RELEVANCE_CONTEXT_POLICY_VERSION = "relevance-context-v1";
const MAX_ENTITIES = 64;
const MAX_FACTS_PER_VISIBILITY = 160;
const TARGET_TOKEN_BUDGET = 12_000;

type Candidate = {
  entityId: string;
  score: number;
  reasons: Set<ContextInclusionReason>;
  known: boolean;
};

type EntityRow = {
  instance_id: string;
  definition_id: string;
  definition_type: string;
  name: string;
  concept_summary: string;
  location_id: string | null;
  owner_id: string | null;
  controller_id: string | null;
  condition: number;
  lifecycle_status: string;
  version: string;
  state: Record<string, unknown>;
};

export class RelevanceContextError extends Error {
  constructor(
    readonly code: "viewpoint_not_found" | "forbidden" | "cross_world_reference",
    message: string,
  ) {
    super(message);
    this.name = "RelevanceContextError";
  }
}

const boundedCommand = (command: string) => command.trim().slice(0, 500);
const commandHash = (command: string) => createHash("sha256").update(command).digest("hex");

function factId(input: {
  viewpointId: string;
  entityId?: string;
  claim: string;
  value: unknown;
  visibility: string;
  sourceId: string;
}) {
  const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 40);
  return `context:v1:${digest}`;
}

function estimateTokens(value: unknown) {
  return Math.ceil(JSON.stringify(value).length / 4);
}

function addCandidate(
  candidates: Map<string, Candidate>,
  entityId: string,
  score: number,
  reason: ContextInclusionReason,
  known: boolean,
) {
  const current = candidates.get(entityId);
  if (current) {
    current.score += score;
    current.reasons.add(reason);
    current.known ||= known;
    return;
  }
  candidates.set(entityId, {
    entityId,
    score,
    reasons: new Set([reason]),
    known,
  });
}

export function createRelevanceContextStore(database: ReturnType<typeof createDatabase>) {
  async function requireViewpoint(scope: WorldScope, viewpointId: string): Promise<EntityRow> {
    const rows = await database.client<EntityRow[]>`
      SELECT instance.instance_id, instance.definition_id, definition.definition_type,
             definition.name, definition.concept_summary, instance.location_id,
             instance.owner_id, instance.controller_id, instance.condition,
             instance.lifecycle_status, instance.version::text, instance.state
      FROM game.entity_instances instance
      JOIN game.entity_definitions definition
        ON definition.definition_id = instance.definition_id
      JOIN game.player_characters character
        ON character.character_instance_id = instance.instance_id
       AND character.world_id = instance.world_id
      WHERE instance.world_id = ${scope.worldId}
        AND instance.shard_id = ${scope.shardId}
        AND instance.instance_id = ${viewpointId}
        AND character.user_id = ${scope.userId}
    `;
    const row = rows[0];
    if (!row) {
      const anywhere = await database.client`
        SELECT 1 FROM game.entity_instances WHERE instance_id = ${viewpointId}
      `;
      throw new RelevanceContextError(
        anywhere[0] ? "forbidden" : "viewpoint_not_found",
        anywhere[0] ? "Viewpoint is not controlled in the active world." : "Viewpoint not found.",
      );
    }
    return row;
  }

  async function markSalient(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    viewpointId: string;
    entityId: string;
    score: number;
    reasons: ContextInclusionReason[];
    sourceEventId?: string;
    expiresAt?: Date;
  }) {
    if (input.entityId === input.viewpointId) return;
    await database.client`
      INSERT INTO game.entity_salience (
        world_id, shard_id, viewpoint_instance_id, entity_instance_id,
        score, reasons, source_event_id, last_referenced_at, expires_at
      ) VALUES (
        ${input.scope.worldId}, ${input.scope.shardId}, ${input.viewpointId},
        ${input.entityId}, ${Math.max(-10_000, Math.min(10_000, input.score))},
        ${json([...new Set(input.reasons)])}::jsonb, ${input.sourceEventId || null},
        now(), ${input.expiresAt?.toISOString() || null}
      )
      ON CONFLICT (world_id, shard_id, viewpoint_instance_id, entity_instance_id)
      DO UPDATE SET
        score = GREATEST(-10000, LEAST(10000,
          game.entity_salience.score + EXCLUDED.score
        )),
        reasons = (
          SELECT jsonb_agg(DISTINCT value)
          FROM jsonb_array_elements(
            game.entity_salience.reasons || EXCLUDED.reasons
          ) value
        ),
        source_event_id = COALESCE(EXCLUDED.source_event_id, game.entity_salience.source_event_id),
        last_referenced_at = now(),
        expires_at = EXCLUDED.expires_at
    `;
  }

  async function compile(input: {
    scope: WorldScope;
    viewpointId: string;
    command: string;
    explicitEntityIds?: string[];
    activePlanId?: string;
  }): Promise<RelevanceCompiledContext> {
    const command = boundedCommand(input.command);
    const viewpoint = await requireViewpoint(input.scope, input.viewpointId);
    const candidates = new Map<string, Candidate>();
    addCandidate(candidates, viewpoint.instance_id, 100_000, "actor", true);

    const explicitEntityIds = [...new Set(input.explicitEntityIds || [])];
    for (const entityId of explicitEntityIds) {
      const rows = await database.client`
        SELECT 1
        FROM game.entity_instances
        WHERE world_id = ${input.scope.worldId}
          AND shard_id = ${input.scope.shardId}
          AND instance_id = ${entityId}
      `;
      if (!rows[0]) {
        throw new RelevanceContextError(
          "cross_world_reference",
          "Explicit entity reference is outside the active world or shard.",
        );
      }
      addCandidate(candidates, entityId, 50_000, "explicit_reference", true);
    }

    const locationChain = viewpoint.location_id
      ? await database.client<{ instance_id: string; depth: number }[]>`
          WITH RECURSIVE chain(instance_id, depth) AS (
            SELECT ${viewpoint.location_id}::uuid, 0
            UNION ALL
            SELECT parent.location_id, chain.depth + 1
            FROM chain
            JOIN game.entity_instances parent
              ON parent.instance_id = chain.instance_id
            WHERE parent.location_id IS NOT NULL AND chain.depth < 8
          )
          SELECT instance_id, depth FROM chain ORDER BY depth
        `
      : [];
    for (const location of locationChain) {
      addCandidate(
        candidates,
        location.instance_id,
        20_000 - location.depth * 1_000,
        location.depth === 0 ? "same_location" : "location_ancestor",
        true,
      );
    }

    if (viewpoint.location_id) {
      const nearby = await database.client<
        {
          instance_id: string;
          owner_id: string | null;
          controller_id: string | null;
          observed: boolean;
        }[]
      >`
        SELECT instance.instance_id, instance.owner_id, instance.controller_id,
               EXISTS (
                 SELECT 1
                 FROM game.entity_relations observation
                 WHERE observation.world_id = instance.world_id
                   AND observation.source_instance_id = ${input.viewpointId}
                   AND observation.target_instance_id = instance.instance_id
                   AND observation.relation_type = 'observed'
                   AND observation.parameters ->> 'visibility' = 'player_known'
               ) AS observed
        FROM game.entity_instances instance
        WHERE instance.world_id = ${input.scope.worldId}
          AND instance.shard_id = ${input.scope.shardId}
          AND instance.location_id = ${viewpoint.location_id}
          AND instance.instance_id <> ${input.viewpointId}
          AND instance.lifecycle_status <> 'merged'
        ORDER BY instance.updated_at DESC
        LIMIT 96
      `;
      for (const entity of nearby) {
        const controlled =
          entity.owner_id === input.viewpointId || entity.controller_id === input.viewpointId;
        addCandidate(
          candidates,
          entity.instance_id,
          15_000,
          "same_location",
          entity.observed || controlled,
        );
      }
    }

    const controlledEntities = await database.client<
      {
        instance_id: string;
        owner_id: string | null;
        controller_id: string | null;
      }[]
    >`
      SELECT instance_id, owner_id, controller_id
      FROM game.entity_instances
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND (owner_id = ${input.viewpointId} OR controller_id = ${input.viewpointId})
        AND instance_id <> ${input.viewpointId}
        AND lifecycle_status <> 'merged'
      ORDER BY updated_at DESC
      LIMIT 96
    `;
    for (const entity of controlledEntities) {
      if (entity.owner_id === input.viewpointId) {
        addCandidate(candidates, entity.instance_id, 12_000, "owned", true);
      }
      if (entity.controller_id === input.viewpointId) {
        addCandidate(candidates, entity.instance_id, 12_000, "controlled", true);
      }
    }

    const relations = await database.client<
      {
        source_instance_id: string;
        target_instance_id: string;
        relation_type: string;
        parameters: Record<string, unknown>;
      }[]
    >`
      SELECT source_instance_id, target_instance_id, relation_type, parameters
      FROM game.entity_relations
      WHERE world_id = ${input.scope.worldId}
        AND (
          source_instance_id = ${input.viewpointId}
          OR target_instance_id = ${input.viewpointId}
        )
      ORDER BY created_at DESC
      LIMIT 128
    `;
    for (const relation of relations) {
      const otherId =
        relation.source_instance_id === input.viewpointId
          ? relation.target_instance_id
          : relation.source_instance_id;
      const visible = relation.parameters?.visibility === "player_known";
      const reason: ContextInclusionReason =
        relation.relation_type === "possessed_by"
          ? "possessed"
          : ["following", "accompanying"].includes(relation.relation_type)
            ? "accompanying"
            : relation.relation_type === "contained_in"
              ? "contained"
              : "relationship";
      addCandidate(
        candidates,
        otherId,
        reason === "accompanying" ? 18_000 : 8_000,
        reason,
        visible,
      );
    }

    const salience = await database.client<
      {
        entity_instance_id: string;
        score: number;
        reasons: ContextInclusionReason[];
      }[]
    >`
      SELECT entity_instance_id, score, reasons
      FROM game.entity_salience
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND viewpoint_instance_id = ${input.viewpointId}
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY score DESC, last_referenced_at DESC
      LIMIT 96
    `;
    for (const salient of salience) {
      for (const reason of salient.reasons || ["recent_reference"]) {
        addCandidate(candidates, salient.entity_instance_id, salient.score, reason, true);
      }
    }

    const recentEvents = await database.client<
      { event_id: string; involved_entity_ids: string[] }[]
    >`
      SELECT event_id, involved_entity_ids
      FROM game.event_ledger
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND involved_entity_ids ? ${input.viewpointId}
      ORDER BY world_time DESC, created_at DESC
      LIMIT 24
    `;
    recentEvents.forEach((event, eventIndex) => {
      for (const entityId of event.involved_entity_ids || []) {
        if (entityId !== input.viewpointId) {
          addCandidate(
            candidates,
            entityId,
            Math.max(500, 4_000 - eventIndex * 125),
            "recent_event",
            false,
          );
        }
      }
    });

    const scheduleRows = await database.client<{ subject_entity_ids: string[] }[]>`
      SELECT subject_entity_ids
      FROM game.scheduled_actions
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND status IN ('pending', 'resolving')
        AND subject_entity_ids ? ${input.viewpointId}
      ORDER BY resolves_at
      LIMIT 24
    `;
    for (const schedule of scheduleRows) {
      for (const entityId of schedule.subject_entity_ids || []) {
        addCandidate(
          candidates,
          entityId,
          14_000,
          "scheduled_work",
          entityId === input.viewpointId,
        );
      }
    }

    const planTable = await database.client<{ exists: boolean }[]>`
      SELECT to_regclass('game.action_plans') IS NOT NULL AS exists
    `;
    if (planTable[0]?.exists) {
      const planEntities = await database.client<{ entity_id: string }[]>`
        SELECT DISTINCT entity_id
        FROM game.action_plan_entities
        WHERE world_id = ${input.scope.worldId}
          AND plan_id = ${input.activePlanId || null}
      `.catch(() => [] as { entity_id: string }[]);
      for (const entity of planEntities) {
        addCandidate(candidates, entity.entity_id, 30_000, "active_plan", true);
      }
    }

    const rankedCandidates = [...candidates.values()].sort(
      (left, right) => right.score - left.score || left.entityId.localeCompare(right.entityId),
    );
    const selectedCandidates = rankedCandidates.slice(0, MAX_ENTITIES);
    const selectedIds = selectedCandidates.map(({ entityId }) => entityId);
    const entityRows = selectedIds.length
      ? await database.client<EntityRow[]>`
          SELECT instance.instance_id, instance.definition_id, definition.definition_type,
                 definition.name, definition.concept_summary, instance.location_id,
                 instance.owner_id, instance.controller_id, instance.condition,
                 instance.lifecycle_status, instance.version::text, instance.state
          FROM game.entity_instances instance
          JOIN game.entity_definitions definition
            ON definition.definition_id = instance.definition_id
          WHERE instance.world_id = ${input.scope.worldId}
            AND instance.shard_id = ${input.scope.shardId}
            AND instance.instance_id = ANY(${selectedIds}::uuid[])
        `
      : [];
    const rowsById = new Map(entityRows.map((row) => [row.instance_id, row]));

    const knownFacts: RelevanceContextFact[] = [];
    const hiddenFacts: RelevanceContextFact[] = [];
    const entities: RelevanceCompiledContext["entities"] = [];
    const addFact = (
      candidate: Candidate,
      row: EntityRow,
      claim: string,
      value: unknown,
      visibility: "player_known" | "authoritative_hidden",
      provenance: RelevanceContextFact["provenance"],
    ) => {
      const target = visibility === "player_known" ? knownFacts : hiddenFacts;
      if (target.length >= MAX_FACTS_PER_VISIBILITY) return;
      target.push(
        RelevanceContextFactSchema.parse({
          factId: factId({
            viewpointId: input.viewpointId,
            entityId: row.instance_id,
            claim,
            value,
            visibility,
            sourceId: provenance.sourceId,
          }),
          entityId: row.instance_id,
          claim,
          value,
          visibility,
          provenance,
          relevanceScore: candidate.score,
          inclusionReasons: [...candidate.reasons],
        }),
      );
    };

    for (const candidate of selectedCandidates) {
      const row = rowsById.get(candidate.entityId);
      if (!row) continue;
      const visibility = candidate.known ? "player_known" : "authoritative_hidden";
      entities.push({
        entityId: row.instance_id,
        definitionId: row.definition_id,
        name: row.name,
        definitionType: row.definition_type,
        locationId: row.location_id,
        ...(candidate.known &&
        (row.instance_id === input.viewpointId ||
          row.owner_id === input.viewpointId ||
          row.controller_id === input.viewpointId)
          ? { condition: row.condition }
          : {}),
        lifecycleStatus: row.lifecycle_status,
        version: Number(row.version),
        visibility,
        relevanceScore: candidate.score,
        inclusionReasons: [...candidate.reasons],
      });
      addFact(candidate, row, "entity.name", row.name, visibility, {
        kind: "content_definition",
        sourceId: row.definition_id,
      });
      addFact(candidate, row, "entity.definition_type", row.definition_type, visibility, {
        kind: "content_definition",
        sourceId: row.definition_id,
      });
      addFact(candidate, row, "entity.lifecycle_status", row.lifecycle_status, visibility, {
        kind: "world_state",
        sourceId: row.instance_id,
      });
      if (row.location_id) {
        addFact(candidate, row, "entity.location", row.location_id, visibility, {
          kind: "world_state",
          sourceId: row.instance_id,
        });
      }
      if (
        row.instance_id === input.viewpointId ||
        row.owner_id === input.viewpointId ||
        row.controller_id === input.viewpointId
      ) {
        addFact(candidate, row, "entity.condition", row.condition, "player_known", {
          kind: "character_state",
          sourceId: row.instance_id,
        });
        addFact(
          candidate,
          row,
          "entity.state",
          row.state || {},
          row.instance_id === input.viewpointId ? "player_known" : visibility,
          { kind: "character_state", sourceId: row.instance_id },
        );
      } else {
        addFact(candidate, row, "entity.condition", row.condition, "authoritative_hidden", {
          kind: "character_state",
          sourceId: row.instance_id,
        });
        addFact(candidate, row, "entity.state", row.state || {}, "authoritative_hidden", {
          kind: "character_state",
          sourceId: row.instance_id,
        });
      }
    }

    const informationRows = await database.client<
      {
        information_id: string;
        subject_instance_id: string | null;
        content: string;
        confidence: string;
        truth_status: string;
        source_event_id: string;
      }[]
    >`
      SELECT information_id, subject_instance_id, content,
             confidence::text, truth_status, source_event_id
      FROM game.information_assets
      WHERE world_id = ${input.scope.worldId}
        AND holder_instance_id = ${input.viewpointId}
        AND valid_until IS NULL
      ORDER BY created_at DESC
      LIMIT 48
    `;
    for (const information of informationRows) {
      if (knownFacts.length >= MAX_FACTS_PER_VISIBILITY) break;
      const candidate = information.subject_instance_id
        ? candidates.get(information.subject_instance_id)
        : undefined;
      knownFacts.push(
        RelevanceContextFactSchema.parse({
          factId: factId({
            viewpointId: input.viewpointId,
            entityId: information.subject_instance_id || undefined,
            claim: "held_information",
            value: information.content,
            visibility: "player_known",
            sourceId: information.information_id,
          }),
          ...(information.subject_instance_id ? { entityId: information.subject_instance_id } : {}),
          claim: "held_information",
          value: {
            content: information.content,
            confidence: Number(information.confidence),
            truthStatus: information.truth_status,
          },
          visibility: "player_known",
          provenance: {
            kind: "held_information",
            sourceId: information.source_event_id,
          },
          relevanceScore: candidate?.score || 2_000,
          inclusionReasons: ["held_information"],
        }),
      );
    }

    if (viewpoint.location_id) {
      const sourceRows = await database.client<
        {
          source_id: string;
          name: string;
          description: string;
          semantic_scope: Record<string, unknown>;
          constraints: string[];
          capacity: string;
        }[]
      >`
        SELECT source_id, name, description, semantic_scope, constraints, capacity::text
        FROM game.materialization_sources
        WHERE world_id = ${input.scope.worldId}
          AND shard_id = ${input.scope.shardId}
          AND location_instance_id = ${viewpoint.location_id}
          AND status = 'active'
          AND capacity > 0
        ORDER BY created_at
        LIMIT 16
      `;
      for (const source of sourceRows) {
        if (hiddenFacts.length >= MAX_FACTS_PER_VISIBILITY) break;
        hiddenFacts.push(
          RelevanceContextFactSchema.parse({
            factId: factId({
              viewpointId: input.viewpointId,
              claim: "materialization_source",
              value: source.source_id,
              visibility: "authoritative_hidden",
              sourceId: source.source_id,
            }),
            claim: "materialization_source",
            value: {
              sourceId: source.source_id,
              name: source.name,
              description: source.description,
              semanticScope: source.semantic_scope || {},
              constraints: source.constraints || [],
              capacity: Number(source.capacity),
            },
            visibility: "authoritative_hidden",
            provenance: { kind: "materialization_source", sourceId: source.source_id },
            relevanceScore: 9_000,
            inclusionReasons: ["materialization_source"],
          }),
        );
      }
    }

    let estimatedTokens = estimateTokens({ entities, knownFacts, hiddenFacts });
    while (
      estimatedTokens > TARGET_TOKEN_BUDGET &&
      (knownFacts.length > 8 || hiddenFacts.length > 8)
    ) {
      const knownTail = knownFacts.at(-1)?.relevanceScore ?? Number.POSITIVE_INFINITY;
      const hiddenTail = hiddenFacts.at(-1)?.relevanceScore ?? Number.POSITIVE_INFINITY;
      if (knownFacts.length > 8 && knownTail <= hiddenTail) knownFacts.pop();
      else if (hiddenFacts.length > 8) hiddenFacts.pop();
      estimatedTokens = estimateTokens({ entities, knownFacts, hiddenFacts });
    }

    const compilationId = randomUUID();
    const selectedFactIds = [...knownFacts, ...hiddenFacts].map(({ factId }) => factId);
    const omitted = rankedCandidates.slice(MAX_ENTITIES);
    await database.client`
      INSERT INTO game.context_compilation_audits (
        compilation_id, world_id, shard_id, user_id, viewpoint_instance_id,
        command_hash, command_excerpt, explicit_entity_ids, candidate_scores,
        selected_fact_ids, omitted_candidates, fact_count, estimated_tokens,
        policy_version
      ) VALUES (
        ${compilationId}, ${input.scope.worldId}, ${input.scope.shardId},
        ${input.scope.userId}, ${input.viewpointId}, ${commandHash(command)},
        ${command}, ${json(explicitEntityIds)}::jsonb,
        ${json(
          rankedCandidates.map((candidate) => ({
            entityId: candidate.entityId,
            score: candidate.score,
            reasons: [...candidate.reasons],
            known: candidate.known,
          })),
        )}::jsonb,
        ${json(selectedFactIds)}::jsonb,
        ${json(
          omitted.map((candidate) => ({
            entityId: candidate.entityId,
            score: candidate.score,
            reasons: [...candidate.reasons],
          })),
        )}::jsonb,
        ${selectedFactIds.length}, ${estimatedTokens}, ${RELEVANCE_CONTEXT_POLICY_VERSION}
      )
    `;

    await Promise.all(
      explicitEntityIds
        .filter((entityId) => entityId !== input.viewpointId)
        .map((entityId) =>
          markSalient({
            scope: input.scope,
            viewpointId: input.viewpointId,
            entityId,
            score: 2_000,
            reasons: ["explicit_reference"],
          }),
        ),
    );

    return RelevanceCompiledContextSchema.parse({
      compilationId,
      policyVersion: RELEVANCE_CONTEXT_POLICY_VERSION,
      worldId: input.scope.worldId,
      shardId: input.scope.shardId,
      viewpointId: input.viewpointId,
      commandExcerpt: command,
      entities,
      playerKnownFacts: knownFacts,
      authoritativeHiddenFacts: hiddenFacts,
      omittedCandidateCount: omitted.length,
      estimatedTokens,
    });
  }

  return { compile, markSalient };
}

export type RelevanceContextStore = ReturnType<typeof createRelevanceContextStore>;
