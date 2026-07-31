import {
  PersistentWorldSceneSchema,
  type PersistentSceneEntity,
  type PersistentWorldScene,
} from "../../contracts/src/persistent-scene.js";
import { PersistentActionPlanSchema } from "../../contracts/src/action-plans.js";
import type { createDatabase } from "./index.js";
import type { WorldScope } from "./world-store.js";

export class PersistentSceneStoreError extends Error {
  constructor(
    readonly code: "actor_not_found" | "forbidden",
    message: string,
  ) {
    super(message);
    this.name = "PersistentSceneStoreError";
  }
}

type EntityRow = {
  instance_id: string;
  definition_type: string;
  name: string;
  lifecycle_status: string;
  location_id: string | null;
  location_name: string | null;
  relation_types: string[] | null;
  aliases: string[] | null;
  last_observed_at: Date | null;
  presence: PersistentSceneEntity["presence"];
};

export function createPersistentSceneStore(database: ReturnType<typeof createDatabase>) {
  async function requireActor(scope: WorldScope, actorId: string) {
    const rows = await database.client<
      { instance_id: string; location_id: string | null; name: string }[]
    >`
      SELECT instance.instance_id, instance.location_id, definition.name
      FROM game.entity_instances instance
      JOIN game.entity_definitions definition
        ON definition.definition_id = instance.definition_id
      JOIN game.player_characters character
        ON character.world_id = instance.world_id
       AND character.character_instance_id = instance.instance_id
      WHERE instance.world_id = ${scope.worldId}
        AND instance.shard_id = ${scope.shardId}
        AND instance.instance_id = ${actorId}
        AND character.user_id = ${scope.userId}
    `;
    const actor = rows[0];
    if (!actor) {
      const exists = await database.client`
        SELECT 1 FROM game.entity_instances WHERE instance_id = ${actorId}
      `;
      throw new PersistentSceneStoreError(
        exists[0] ? "forbidden" : "actor_not_found",
        exists[0] ? "Actor is not controlled in this world." : "Actor not found.",
      );
    }
    return actor;
  }

  async function buildEntityRows(
    scope: WorldScope,
    actorId: string,
    actorLocationId: string | null,
  ) {
    return database.client<EntityRow[]>`
      WITH visible_relation_entities AS (
        SELECT relation.target_instance_id AS entity_id,
               relation.relation_type,
               relation.created_at
        FROM game.entity_relations relation
        WHERE relation.world_id = ${scope.worldId}
          AND relation.source_instance_id = ${actorId}
          AND relation.valid_until IS NULL
          AND relation.parameters ->> 'visibility' = 'player_known'
        UNION ALL
        SELECT relation.source_instance_id AS entity_id,
               relation.relation_type,
               relation.created_at
        FROM game.entity_relations relation
        WHERE relation.world_id = ${scope.worldId}
          AND relation.target_instance_id = ${actorId}
          AND relation.valid_until IS NULL
          AND relation.parameters ->> 'visibility' = 'player_known'
      ),
      candidate_entities AS (
        SELECT instance.instance_id,
               CASE
                 WHEN instance.location_id IS NOT DISTINCT FROM ${actorLocationId}
                   AND EXISTS (
                     SELECT 1 FROM game.entity_relations observed
                     WHERE observed.world_id = instance.world_id
                       AND observed.source_instance_id = ${actorId}
                       AND observed.target_instance_id = instance.instance_id
                       AND observed.relation_type = 'observed'
                       AND observed.valid_until IS NULL
                       AND observed.parameters ->> 'visibility' = 'player_known'
                   ) THEN 'nearby'
                 WHEN EXISTS (
                   SELECT 1 FROM game.entity_relations accompanied
                   WHERE accompanied.world_id = instance.world_id
                     AND accompanied.source_instance_id = instance.instance_id
                     AND accompanied.target_instance_id = ${actorId}
                     AND accompanied.relation_type IN ('following', 'accompanying')
                     AND accompanied.valid_until IS NULL
                 ) THEN 'accompanying'
                 WHEN EXISTS (
                   SELECT 1 FROM game.entity_relations carried
                   WHERE carried.world_id = instance.world_id
                     AND carried.source_instance_id = instance.instance_id
                     AND carried.target_instance_id = ${actorId}
                     AND carried.relation_type IN ('possessed_by', 'in_custody_of')
                     AND carried.valid_until IS NULL
                 ) THEN 'carried'
                 ELSE 'known_elsewhere'
               END AS presence
        FROM game.entity_instances instance
        WHERE instance.world_id = ${scope.worldId}
          AND instance.shard_id = ${scope.shardId}
          AND instance.instance_id <> ${actorId}
          AND instance.lifecycle_status <> 'merged'
          AND (
            instance.owner_id = ${actorId}
            OR instance.controller_id = ${actorId}
            OR EXISTS (
              SELECT 1 FROM visible_relation_entities visible
              WHERE visible.entity_id = instance.instance_id
            )
            OR EXISTS (
              SELECT 1 FROM game.information_assets information
              WHERE information.world_id = instance.world_id
                AND information.holder_instance_id = ${actorId}
                AND information.subject_instance_id = instance.instance_id
                AND information.valid_until IS NULL
            )
          )
      )
      SELECT instance.instance_id, definition.definition_type, definition.name,
             instance.lifecycle_status, instance.location_id,
             location_definition.name AS location_name,
             ARRAY(
               SELECT DISTINCT relation_type
               FROM visible_relation_entities visible
               WHERE visible.entity_id = instance.instance_id
               ORDER BY relation_type
             ) AS relation_types,
             ARRAY(
               SELECT alias.alias_text
               FROM game.entity_aliases alias
               WHERE alias.world_id = instance.world_id
                 AND alias.entity_instance_id = instance.instance_id
                 AND alias.valid_until IS NULL
                 AND (
                   alias.viewpoint_instance_id IS NULL
                   OR alias.viewpoint_instance_id = ${actorId}
                 )
               ORDER BY alias.valid_from DESC
               LIMIT 24
             ) AS aliases,
             (
               SELECT MAX(observed.created_at)
               FROM game.entity_relations observed
               WHERE observed.world_id = instance.world_id
                 AND observed.source_instance_id = ${actorId}
                 AND observed.target_instance_id = instance.instance_id
                 AND observed.relation_type = 'observed'
             ) AS last_observed_at,
             candidate.presence
      FROM candidate_entities candidate
      JOIN game.entity_instances instance ON instance.instance_id = candidate.instance_id
      JOIN game.entity_definitions definition
        ON definition.definition_id = instance.definition_id
      LEFT JOIN game.entity_instances location
        ON location.instance_id = instance.location_id
      LEFT JOIN game.entity_definitions location_definition
        ON location_definition.definition_id = location.definition_id
      ORDER BY
        CASE candidate.presence
          WHEN 'nearby' THEN 0
          WHEN 'accompanying' THEN 1
          WHEN 'carried' THEN 2
          ELSE 3
        END,
        definition.name,
        instance.instance_id
      LIMIT 256
    `;
  }

  function mapEntity(row: EntityRow): PersistentSceneEntity {
    return {
      entityId: row.instance_id,
      name: row.name,
      definitionType: row.definition_type,
      lifecycleStatus: row.lifecycle_status,
      locationId: row.location_id,
      locationName: row.location_name,
      relationshipLabels: row.relation_types || [],
      aliases: row.aliases?.length ? row.aliases : [row.name],
      statusSummary: null,
      lastObservedAt: row.last_observed_at?.toISOString() || null,
      presence: row.presence,
    };
  }

  async function readPlan(scope: WorldScope, actorId: string) {
    const plans = await database.client<
      {
        plan_id: string;
        status: string;
        plan_version: string;
        active_step_id: string | null;
        exclusive_physical: boolean;
        created_at: Date;
        updated_at: Date;
      }[]
    >`
      SELECT plan_id, status, plan_version::text, active_step_id,
             exclusive_physical, created_at, updated_at
      FROM game.action_plans
      WHERE world_id = ${scope.worldId}
        AND shard_id = ${scope.shardId}
        AND actor_id = ${actorId}
        AND status IN (
          'planned', 'running', 'waiting_for_time', 'waiting_for_world_event',
          'waiting_for_clarification', 'blocked'
        )
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const plan = plans[0];
    if (!plan) return null;
    const steps = await database.client<
      {
        step_id: string;
        step_order: number;
        step_kind: string;
        description: string;
        status: string;
        idempotency_key: string;
        waiting_reason: string | null;
        outcome_grade: string | null;
      }[]
    >`
      SELECT step_id, step_order, step_kind, description, status,
             idempotency_key, waiting_reason, outcome_grade
      FROM game.action_plan_steps
      WHERE plan_id = ${plan.plan_id}
      ORDER BY step_order
    `;
    return PersistentActionPlanSchema.parse({
      planId: plan.plan_id,
      actorId,
      status: plan.status,
      planVersion: Number(plan.plan_version),
      activeStepId: plan.active_step_id,
      exclusivePhysical: plan.exclusive_physical,
      steps: steps.map((step) => ({
        stepId: step.step_id,
        order: step.step_order,
        kind: step.step_kind,
        description: step.description,
        status: step.status,
        idempotencyKey: step.idempotency_key,
        waitingReason: step.waiting_reason,
        outcomeGrade: step.outcome_grade,
      })),
      createdAt: plan.created_at.toISOString(),
      updatedAt: plan.updated_at.toISOString(),
    });
  }

  async function build(input: {
    scope: WorldScope;
    actorId: string;
  }): Promise<PersistentWorldScene> {
    const actor = await requireActor(input.scope, input.actorId);
    const hierarchy = actor.location_id
      ? await database.client<{ location_id: string; name: string; depth: number }[]>`
          WITH RECURSIVE chain(location_id, name, depth) AS (
            SELECT instance.instance_id, definition.name, 0
            FROM game.entity_instances instance
            JOIN game.entity_definitions definition
              ON definition.definition_id = instance.definition_id
            WHERE instance.world_id = ${input.scope.worldId}
              AND instance.shard_id = ${input.scope.shardId}
              AND instance.instance_id = ${actor.location_id}
            UNION ALL
            SELECT parent.instance_id, definition.name, chain.depth + 1
            FROM chain
            JOIN game.entity_instances current_location
              ON current_location.instance_id = chain.location_id
            JOIN game.entity_instances parent
              ON parent.instance_id = current_location.location_id
            JOIN game.entity_definitions definition
              ON definition.definition_id = parent.definition_id
            WHERE chain.depth < 15
          )
          SELECT location_id, name, depth FROM chain ORDER BY depth DESC
        `
      : [];
    const entityRows = await buildEntityRows(input.scope, input.actorId, actor.location_id);
    const entities = entityRows.map(mapEntity);
    const activePlan = await readPlan(input.scope, input.actorId);
    const scheduled = await database.client<
      {
        schedule_id: string;
        kind: string;
        description: string;
        status: string;
        resolves_at: Date;
        plan_id: string | null;
        step_id: string | null;
      }[]
    >`
      SELECT schedule_id, kind,
             COALESCE(payload ->> 'description', kind) AS description,
             status, resolves_at, plan_id, step_id
      FROM game.scheduled_actions
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND subject_entity_ids ? ${input.actorId}
        AND status IN ('pending', 'retrying', 'resolving')
      ORDER BY resolves_at
      LIMIT 64
    `;
    const recentEvents = await database.client<
      { event_id: string; event_type: string; world_time: Date; payload: Record<string, unknown> }[]
    >`
      SELECT event_id, event_type, world_time, payload
      FROM game.event_ledger
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND involved_entity_ids ? ${input.actorId}
      ORDER BY world_time DESC, created_at DESC
      LIMIT 50
    `;
    const featureRows = await database.client<{ configuration: Record<string, unknown> }[]>`
      SELECT configuration
      FROM game.runtime_features
      WHERE world_id = ${input.scope.worldId}
        AND feature_key = 'persistent_world_runtime'
    `;
    return PersistentWorldSceneSchema.parse({
      worldId: input.scope.worldId,
      shardId: input.scope.shardId,
      actorId: input.actorId,
      location: {
        locationId: actor.location_id,
        name: hierarchy.at(-1)?.name || actor.name,
        hierarchy: hierarchy.map((location) => ({
          locationId: location.location_id,
          name: location.name,
        })),
      },
      nearbyEntities: entities.filter(({ presence }) => presence === "nearby"),
      accompanyingEntities: entities.filter(({ presence }) =>
        ["accompanying", "carried"].includes(presence),
      ),
      knownEntities: entities.filter(({ presence }) => presence === "known_elsewhere"),
      activePlan,
      scheduledWork: scheduled.map((work) => ({
        scheduleId: work.schedule_id,
        kind: work.kind,
        description: work.description,
        status: work.status,
        resolvesAt: work.resolves_at.toISOString(),
        planId: work.plan_id,
        stepId: work.step_id,
      })),
      recentEvents: recentEvents.map((event) => ({
        eventId: event.event_id,
        eventType: event.event_type,
        occurredAt: event.world_time.toISOString(),
        summary:
          typeof event.payload?.playerSummary === "string"
            ? event.payload.playerSummary
            : event.event_type.replaceAll("_", " "),
      })),
      runtimeVersion: String(
        featureRows[0]?.configuration?.runtimeVersion || "persistent-world-v1",
      ),
    });
  }

  return { build };
}

export type PersistentSceneStore = ReturnType<typeof createPersistentSceneStore>;
