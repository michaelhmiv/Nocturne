import { createHash, randomUUID } from "node:crypto";
import {
  EntityReferenceCandidateSchema,
  EntityReferenceInterpretationSchema,
  type EntityReferenceCandidate,
  type EntityReferenceInterpretation,
  type RelevanceCompiledContext,
} from "@nocturne/contracts";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";
import type { WorldScope } from "./world-store.js";

export const REFERENCE_RESOLUTION_POLICY_VERSION = "reference-resolution-v1";

export class ReferenceResolutionStoreError extends Error {
  constructor(
    readonly code: "invalid_input" | "cross_world_reference" | "audit_conflict",
    message: string,
  ) {
    super(message);
    this.name = "ReferenceResolutionStoreError";
  }
}

const commandHash = (command: string) => createHash("sha256").update(command).digest("hex");

function relationshipLabel(relationType: string, outgoing: boolean) {
  if (outgoing) return relationType;
  const inverse: Record<string, string> = {
    following: "followed_by",
    accompanying: "accompanied_by",
    owned_by: "owns",
    possessed_by: "possesses",
    controlled_by: "controls",
    trusts: "trusted_by",
    fears: "feared_by",
    hostile_to: "hostile_from",
    resides_at: "residence_of",
    contained_in: "contains",
    guarding: "guarded_by",
  };
  return inverse[relationType] || `inverse_${relationType}`;
}

export function createReferenceResolutionStore(database: ReturnType<typeof createDatabase>) {
  async function buildCandidates(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    viewpointId: string;
    context: RelevanceCompiledContext;
  }): Promise<EntityReferenceCandidate[]> {
    if (
      input.context.worldId !== input.scope.worldId ||
      input.context.shardId !== input.scope.shardId ||
      input.context.viewpointId !== input.viewpointId
    ) {
      throw new ReferenceResolutionStoreError(
        "cross_world_reference",
        "Compiled context does not match the active viewpoint scope.",
      );
    }
    const entityIds = input.context.entities.map(({ entityId }) => entityId);
    if (entityIds.length === 0) return [];

    const aliases = await database.client<{ entity_instance_id: string; alias_text: string }[]>`
      SELECT entity_instance_id, alias_text
      FROM game.entity_aliases
      WHERE world_id = ${input.scope.worldId}
        AND entity_instance_id = ANY(${entityIds}::uuid[])
        AND valid_until IS NULL
        AND (
          viewpoint_instance_id IS NULL
          OR viewpoint_instance_id = ${input.viewpointId}
        )
      ORDER BY valid_from DESC
    `;
    const aliasesByEntity = new Map<string, string[]>();
    for (const alias of aliases) {
      const list = aliasesByEntity.get(alias.entity_instance_id) || [];
      if (!list.includes(alias.alias_text) && list.length < 20) list.push(alias.alias_text);
      aliasesByEntity.set(alias.entity_instance_id, list);
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
        AND (
          source_instance_id = ANY(${entityIds}::uuid[])
          OR target_instance_id = ANY(${entityIds}::uuid[])
        )
      ORDER BY created_at DESC
    `;
    const relationshipsByEntity = new Map<string, string[]>();
    for (const relation of relations) {
      if (relation.parameters?.visibility !== "player_known") continue;
      const outgoing = relation.source_instance_id === input.viewpointId;
      const entityId = outgoing ? relation.target_instance_id : relation.source_instance_id;
      const list = relationshipsByEntity.get(entityId) || [];
      const label = relationshipLabel(relation.relation_type, outgoing);
      if (!list.includes(label) && list.length < 20) list.push(label);
      relationshipsByEntity.set(entityId, list);
    }

    const factsByEntity = new Map<string, string[]>();
    for (const fact of input.context.playerKnownFacts) {
      if (!fact.entityId) continue;
      const list = factsByEntity.get(fact.entityId) || [];
      if (list.length < 32) list.push(fact.factId);
      factsByEntity.set(fact.entityId, list);
    }

    const actorLocation = input.context.entities.find(
      ({ entityId }) => entityId === input.viewpointId,
    )?.locationId;
    const candidates = input.context.entities
      .filter(
        ({ entityId, visibility }) =>
          entityId !== input.viewpointId && visibility === "player_known",
      )
      .map((entity) => {
        const present = Boolean(actorLocation && entity.locationId === actorLocation);
        const relationships = relationshipsByEntity.get(entity.entityId) || [];
        const accessible =
          present ||
          entity.inclusionReasons.some((reason) =>
            ["owned", "controlled", "possessed", "contained", "accompanying"].includes(reason),
          ) ||
          relationships.some((relationship) =>
            ["following", "accompanying", "owned_by", "possessed_by", "contained_in"].includes(
              relationship,
            ),
          );
        return EntityReferenceCandidateSchema.parse({
          entityId: entity.entityId,
          displayName: entity.name,
          definitionType: entity.definitionType,
          lifecycleStatus: entity.lifecycleStatus,
          locationId: entity.locationId,
          aliases: aliasesByEntity.get(entity.entityId) || [entity.name],
          relationshipLabels: relationships,
          relevanceScore: entity.relevanceScore,
          accessible,
          present,
          supportingFactIds: factsByEntity.get(entity.entityId) || [],
        });
      })
      .sort(
        (left, right) =>
          right.relevanceScore - left.relevanceScore || left.entityId.localeCompare(right.entityId),
      );
    return candidates.slice(0, 96);
  }

  async function recordInterpretation(input: {
    scope: Pick<WorldScope, "worldId" | "shardId" | "userId">;
    viewpointId: string;
    command: string;
    interpretation: EntityReferenceInterpretation;
    candidates: EntityReferenceCandidate[];
  }) {
    const interpretation = EntityReferenceInterpretationSchema.parse(input.interpretation);
    const candidateMap = new Map(
      input.candidates.map((candidate) => [candidate.entityId, candidate]),
    );
    const hash = commandHash(input.command);
    return database.client.begin(async (sql) => {
      const resolutionIds: string[] = [];
      for (const mention of interpretation.mentions) {
        const resolutionId = randomUUID();
        const candidateRecords = mention.candidateEntityIds.map((entityId) => {
          const candidate = candidateMap.get(entityId);
          if (!candidate) {
            throw new ReferenceResolutionStoreError(
              "invalid_input",
              "Reference interpretation includes an unavailable candidate.",
            );
          }
          return {
            entityId,
            displayName: candidate.displayName,
            relevanceScore: candidate.relevanceScore,
            accessible: candidate.accessible,
            present: candidate.present,
            aliases: candidate.aliases,
            relationshipLabels: candidate.relationshipLabels,
          };
        });
        try {
          await sql`
            INSERT INTO game.entity_reference_resolutions (
              resolution_id, world_id, shard_id, user_id, viewpoint_instance_id,
              command_hash, command_excerpt, mention_order, mention_text,
              mention_kind, status, selected_entity_id, candidates, confidence,
              supporting_fact_ids, requires_clarification, clarification_prompt,
              policy_version
            ) VALUES (
              ${resolutionId}, ${input.scope.worldId}, ${input.scope.shardId},
              ${input.scope.userId}, ${input.viewpointId}, ${hash},
              ${input.command.slice(0, 500)}, ${mention.order}, ${mention.mentionText},
              ${mention.mentionKind}, ${mention.status},
              ${mention.selectedEntityId || null}, ${json(candidateRecords)}::jsonb,
              ${mention.confidenceBasisPoints / 10_000},
              ${json(mention.supportingFactIds)}::jsonb,
              ${mention.requiresClarification}, ${mention.clarificationPrompt || null},
              ${REFERENCE_RESOLUTION_POLICY_VERSION}
            )
          `;
        } catch (error) {
          if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "23505"
          ) {
            const existing = await sql<{ resolution_id: string }[]>`
              SELECT resolution_id
              FROM game.entity_reference_resolutions
              WHERE world_id = ${input.scope.worldId}
                AND command_hash = ${hash}
                AND viewpoint_instance_id = ${input.viewpointId}
                AND mention_order = ${mention.order}
            `;
            if (existing[0]) {
              resolutionIds.push(existing[0].resolution_id);
              continue;
            }
            throw new ReferenceResolutionStoreError(
              "audit_conflict",
              "Reference resolution audit conflicted.",
            );
          }
          throw error;
        }
        resolutionIds.push(resolutionId);
      }
      return { commandHash: hash, resolutionIds };
    });
  }

  function explicitEntityIds(interpretation: EntityReferenceInterpretation) {
    return interpretation.mentions.flatMap((mention) =>
      mention.status === "resolved" && mention.selectedEntityId ? [mention.selectedEntityId] : [],
    );
  }

  function clarification(interpretation: EntityReferenceInterpretation) {
    const mentions = interpretation.mentions.filter(
      ({ requiresClarification }) => requiresClarification,
    );
    if (mentions.length === 0) return null;
    return mentions
      .map(
        (mention) =>
          mention.clarificationPrompt || `Which entity did you mean by “${mention.mentionText}”?`,
      )
      .join(" ");
  }

  return { buildCandidates, recordInterpretation, explicitEntityIds, clarification };
}

export type ReferenceResolutionStore = ReturnType<typeof createReferenceResolutionStore>;
