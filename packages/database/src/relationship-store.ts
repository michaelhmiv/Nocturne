import { randomUUID } from "node:crypto";
import {
  EffectiveLocationSchema,
  NormalizedRelationshipSchema,
  TravelCohortSchema,
  type TravelCohort,
} from "@nocturne/contracts";
import type { UniversalOperationExecutor } from "./universal-operation-executor.js";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";
import type { WorldScope } from "./world-store.js";

export class RelationshipStoreError extends Error {
  constructor(
    readonly code:
      | "entity_not_found"
      | "relation_type_not_found"
      | "containment_cycle"
      | "invalid_cohort"
      | "stale_cohort",
    message: string,
  ) {
    super(message);
    this.name = "RelationshipStoreError";
  }
}

export function createRelationshipStore(
  database: ReturnType<typeof createDatabase>,
  executor: UniversalOperationExecutor,
) {
  async function listForEntity(input: {
    scope: Pick<WorldScope, "worldId">;
    entityId: string;
    viewpointId?: string;
  }) {
    const rows = await database.client<
      {
        relation_id: string;
        source_instance_id: string;
        target_instance_id: string;
        relation_type: string;
        family: string;
        parameters: Record<string, unknown>;
        default_visibility: "player_known" | "authoritative_hidden";
        valid_until: Date | null;
      }[]
    >`
      SELECT relation.relation_id, relation.source_instance_id,
             relation.target_instance_id, relation.relation_type,
             semantic.family, relation.parameters, semantic.default_visibility,
             relation.valid_until
      FROM game.entity_relations relation
      JOIN game.relation_semantic_families semantic
        ON semantic.relation_type = relation.relation_type
      WHERE relation.world_id = ${input.scope.worldId}
        AND relation.valid_until IS NULL
        AND (
          relation.source_instance_id = ${input.entityId}
          OR relation.target_instance_id = ${input.entityId}
        )
      ORDER BY relation.updated_at DESC, relation.relation_id
    `;
    return rows
      .filter((row) => {
        const visibility = String(row.parameters?.visibility || row.default_visibility);
        return visibility === "player_known" || Boolean(input.viewpointId);
      })
      .map((row) =>
        NormalizedRelationshipSchema.parse({
          relationId: row.relation_id,
          sourceId: row.source_instance_id,
          targetId: row.target_instance_id,
          relationType: row.relation_type,
          family: row.family,
          parameters: row.parameters || {},
          visibility: row.parameters?.visibility || row.default_visibility,
          validUntil: row.valid_until?.toISOString() || null,
        }),
      );
  }

  async function effectiveLocation(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    entityId: string;
  }) {
    const rows = await database.client<
      {
        immediate_location_id: string | null;
        effective_location_id: string | null;
        containment_chain: string[];
        relation_types: string[];
      }[]
    >`
      WITH RECURSIVE position(
        entity_id, immediate_location_id, current_parent_id, chain, relation_types, depth
      ) AS (
        SELECT instance.instance_id,
               instance.location_id,
               COALESCE(
                 possession.target_instance_id,
                 containment.target_instance_id,
                 instance.location_id
               ),
               ARRAY[instance.instance_id]::uuid[],
               ARRAY_REMOVE(ARRAY[
                 CASE WHEN possession.target_instance_id IS NOT NULL THEN 'possessed_by' END,
                 CASE WHEN containment.target_instance_id IS NOT NULL THEN 'contained_in' END
               ]::text[], NULL),
               0
        FROM game.entity_instances instance
        LEFT JOIN game.entity_relations possession
          ON possession.world_id = instance.world_id
         AND possession.source_instance_id = instance.instance_id
         AND possession.relation_type = 'possessed_by'
         AND possession.valid_until IS NULL
        LEFT JOIN game.entity_relations containment
          ON containment.world_id = instance.world_id
         AND containment.source_instance_id = instance.instance_id
         AND containment.relation_type = 'contained_in'
         AND containment.valid_until IS NULL
        WHERE instance.world_id = ${input.scope.worldId}
          AND instance.shard_id = ${input.scope.shardId}
          AND instance.instance_id = ${input.entityId}
        UNION ALL
        SELECT position.entity_id,
               position.immediate_location_id,
               COALESCE(
                 possession.target_instance_id,
                 containment.target_instance_id,
                 parent.location_id
               ),
               position.chain || parent.instance_id,
               position.relation_types || ARRAY_REMOVE(ARRAY[
                 CASE WHEN possession.target_instance_id IS NOT NULL THEN 'possessed_by' END,
                 CASE WHEN containment.target_instance_id IS NOT NULL THEN 'contained_in' END,
                 CASE WHEN parent.location_id IS NOT NULL THEN 'location_id' END
               ]::text[], NULL),
               position.depth + 1
        FROM position
        JOIN game.entity_instances parent
          ON parent.world_id = ${input.scope.worldId}
         AND parent.shard_id = ${input.scope.shardId}
         AND parent.instance_id = position.current_parent_id
        LEFT JOIN game.entity_relations possession
          ON possession.world_id = parent.world_id
         AND possession.source_instance_id = parent.instance_id
         AND possession.relation_type = 'possessed_by'
         AND possession.valid_until IS NULL
        LEFT JOIN game.entity_relations containment
          ON containment.world_id = parent.world_id
         AND containment.source_instance_id = parent.instance_id
         AND containment.relation_type = 'contained_in'
         AND containment.valid_until IS NULL
        WHERE position.current_parent_id IS NOT NULL
          AND position.depth < 31
          AND NOT parent.instance_id = ANY(position.chain)
      )
      SELECT immediate_location_id,
             current_parent_id AS effective_location_id,
             chain AS containment_chain,
             relation_types
      FROM position
      ORDER BY depth DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) throw new RelationshipStoreError("entity_not_found", "Entity not found.");
    return EffectiveLocationSchema.parse({
      entityId: input.entityId,
      immediateLocationId: row.immediate_location_id,
      effectiveLocationId: row.effective_location_id,
      containmentChain: row.containment_chain || [input.entityId],
      derivedFromRelationTypes: row.relation_types || [],
    });
  }

  async function setRelationship(input: {
    scope: WorldScope;
    actorId: string;
    sourceId: string;
    targetId: string;
    relationType: string;
    parameters: Record<string, unknown>;
    preconditionFactIds: string[];
    idempotencyKey: string;
  }) {
    const semanticRows = await database.client<{ exclusive_for_source: boolean; family: string }[]>`
      SELECT exclusive_for_source, family
      FROM game.relation_semantic_families
      WHERE relation_type = ${input.relationType}
        AND mechanically_active
    `;
    const semantic = semanticRows[0];
    if (!semantic) {
      throw new RelationshipStoreError(
        "relation_type_not_found",
        "Normalized relationship type is not supported.",
      );
    }
    const operations: Array<Record<string, unknown>> = [];
    if (semantic.exclusive_for_source) {
      const existing = await database.client<{ target_instance_id: string }[]>`
        SELECT target_instance_id
        FROM game.entity_relations
        WHERE world_id = ${input.scope.worldId}
          AND source_instance_id = ${input.sourceId}
          AND relation_type = ${input.relationType}
          AND valid_until IS NULL
          AND target_instance_id <> ${input.targetId}
      `;
      for (const relation of existing) {
        operations.push({
          type: "remove_relation",
          sourceRef: { kind: "existing", entityId: input.sourceId },
          targetRef: { kind: "existing", entityId: relation.target_instance_id },
          relationType: input.relationType,
          preconditionFactIds: input.preconditionFactIds,
        });
      }
    }
    operations.push({
      type: "set_relation",
      sourceRef: { kind: "existing", entityId: input.sourceId },
      targetRef: { kind: "existing", entityId: input.targetId },
      relationType: input.relationType,
      parameters: input.parameters,
      preconditionFactIds: input.preconditionFactIds,
    });
    return executor.execute({
      scope: input.scope,
      authority: "player",
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
      declaredFactIds: input.preconditionFactIds,
      branch: { operations },
      playerVisibleFacts:
        input.parameters.visibility === "player_known"
          ? [`Relationship established: ${input.relationType}.`]
          : [],
      hiddenFacts: [],
    });
  }

  async function assembleTravelCohort(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    leaderId: string;
    destinationId: string;
    sourceEventId?: string;
  }): Promise<TravelCohort> {
    const destination = await database.client`
      SELECT 1
      FROM game.entity_instances instance
      JOIN game.entity_definitions definition
        ON definition.definition_id = instance.definition_id
      WHERE instance.world_id = ${input.scope.worldId}
        AND instance.shard_id = ${input.scope.shardId}
        AND instance.instance_id = ${input.destinationId}
        AND definition.definition_type IN ('location', 'residence')
    `;
    if (!destination[0]) {
      throw new RelationshipStoreError("invalid_cohort", "Travel destination is invalid.");
    }
    const memberRows = await database.client<
      {
        instance_id: string;
        version: string;
        location_id: string | null;
        relation_type: string;
        parameters: Record<string, unknown>;
      }[]
    >`
      SELECT member.instance_id, member.version::text, member.location_id,
             relation.relation_type, relation.parameters
      FROM game.entity_relations relation
      JOIN game.entity_instances member
        ON member.instance_id = relation.source_instance_id
       AND member.world_id = relation.world_id
      WHERE relation.world_id = ${input.scope.worldId}
        AND member.shard_id = ${input.scope.shardId}
        AND relation.target_instance_id = ${input.leaderId}
        AND relation.valid_until IS NULL
        AND relation.relation_type IN (
          'following', 'accompanying', 'possessed_by', 'in_custody_of'
        )
      ORDER BY member.instance_id
    `;
    const leaderRows = await database.client<{ version: string; location_id: string | null }[]>`
      SELECT version::text, location_id
      FROM game.entity_instances
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND instance_id = ${input.leaderId}
    `;
    const leader = leaderRows[0];
    if (!leader) throw new RelationshipStoreError("entity_not_found", "Travel leader not found.");

    const cohortId = randomUUID();
    const members: TravelCohort["members"] = [
      {
        entityId: input.leaderId,
        role: "leader",
        required: true,
        expectedVersion: Number(leader.version),
        expectedLocationId: leader.location_id,
        validation: {},
      },
      ...memberRows.map((member) => ({
        entityId: member.instance_id,
        role:
          member.relation_type === "following"
            ? ("following" as const)
            : member.relation_type === "possessed_by"
              ? ("carried" as const)
              : member.relation_type === "in_custody_of"
                ? ("restrained" as const)
                : ("companion" as const),
        required: member.parameters?.required !== false,
        expectedVersion: Number(member.version),
        expectedLocationId: member.location_id,
        validation: member.parameters || {},
      })),
    ];
    const cohort = TravelCohortSchema.parse({
      cohortId,
      leaderId: input.leaderId,
      destinationId: input.destinationId,
      status: "assembled",
      members,
    });
    await database.client.begin(async (sql) => {
      await sql`
        INSERT INTO game.travel_cohorts (
          cohort_id, world_id, shard_id, leader_instance_id,
          destination_instance_id, status, source_event_id
        ) VALUES (
          ${cohortId}, ${input.scope.worldId}, ${input.scope.shardId},
          ${input.leaderId}, ${input.destinationId}, 'assembled',
          ${input.sourceEventId || null}
        )
      `;
      for (const member of cohort.members) {
        await sql`
          INSERT INTO game.travel_cohort_members (
            cohort_id, entity_instance_id, role, required, expected_version,
            expected_location_id, validation, status
          ) VALUES (
            ${cohortId}, ${member.entityId}, ${member.role}, ${member.required},
            ${member.expectedVersion}, ${member.expectedLocationId},
            ${json(member.validation)}::jsonb, 'included'
          )
        `;
      }
    });
    return cohort;
  }

  async function travelOperations(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    cohortId: string;
    preconditionFactIds: string[];
  }) {
    const rows = await database.client<
      {
        destination_instance_id: string;
        status: string;
        entity_instance_id: string;
        expected_version: string;
        expected_location_id: string | null;
        required: boolean;
      }[]
    >`
      SELECT cohort.destination_instance_id, cohort.status,
             member.entity_instance_id, member.expected_version::text,
             member.expected_location_id, member.required
      FROM game.travel_cohorts cohort
      JOIN game.travel_cohort_members member ON member.cohort_id = cohort.cohort_id
      WHERE cohort.world_id = ${input.scope.worldId}
        AND cohort.shard_id = ${input.scope.shardId}
        AND cohort.cohort_id = ${input.cohortId}
        AND member.status = 'included'
      ORDER BY CASE member.role WHEN 'leader' THEN 0 ELSE 1 END, member.entity_instance_id
    `;
    if (!rows[0] || rows[0].status !== "assembled") {
      throw new RelationshipStoreError("stale_cohort", "Travel cohort is not ready.");
    }
    return rows.map((row) => ({
      type: "move_entity" as const,
      entityRef: { kind: "existing" as const, entityId: row.entity_instance_id },
      locationRef: { kind: "existing" as const, entityId: row.destination_instance_id },
      expectedVersion: Number(row.expected_version),
      expectedLocationRef: row.expected_location_id
        ? { kind: "existing" as const, entityId: row.expected_location_id }
        : null,
      preconditionFactIds: input.preconditionFactIds,
    }));
  }

  return {
    listForEntity,
    effectiveLocation,
    setRelationship,
    assembleTravelCohort,
    travelOperations,
  };
}

export type RelationshipStore = ReturnType<typeof createRelationshipStore>;
