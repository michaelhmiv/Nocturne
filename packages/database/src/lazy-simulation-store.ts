import { createHash, randomUUID } from "node:crypto";
import type { LazySimulationRequest, LazySimulationResult } from "@nocturne/contracts";
import { LazySimulationResultSchema, SystemResourceKeySchema } from "@nocturne/contracts";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";
import type { WorldScope } from "./world-store.js";

export type LazySimulationClaim = {
  runId: string;
  idempotencyKey: string;
  entityVersion: number;
  simulationVersion: number;
  request: LazySimulationRequest;
};

export class LazySimulationStoreError extends Error {
  constructor(
    readonly code:
      | "entity_not_found"
      | "policy_not_found"
      | "not_due"
      | "lease_conflict"
      | "stale_entity"
      | "run_not_found",
    message: string,
  ) {
    super(message);
    this.name = "LazySimulationStoreError";
  }
}

function runKey(entityId: string, simulationVersion: number, lastSimulatedAt: Date) {
  return `entity-simulation:${entityId}:${simulationVersion}:${createHash("sha256")
    .update(lastSimulatedAt.toISOString())
    .digest("hex")
    .slice(0, 16)}`;
}

export function createLazySimulationStore(database: ReturnType<typeof createDatabase>) {
  async function claim(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    entityId: string;
    leaseOwner: string;
    forceIfRelevant?: boolean;
    relevantFacts?: string[];
    accessibleLocationIds?: string[];
  }): Promise<LazySimulationClaim | null> {
    return database.client.begin(async (sql) => {
      const rows = await sql<
        {
          instance_id: string;
          definition_type: string;
          definition_name: string;
          lifecycle_status: string;
          condition: number;
          state: Record<string, unknown>;
          location_id: string | null;
          version: string;
          simulation_version: string;
          last_simulated_at: Date;
          next_simulation_at: Date | null;
          policy_id: string | null;
          policy_version: string | null;
          policy_description: string | null;
          minimum_interval_seconds: number | null;
          maximum_elapsed_seconds: number | null;
          state_keys: string[] | null;
          resource_keys: string[] | null;
          allowed_operation_types: string[] | null;
          constraints: string[] | null;
        }[]
      >`
        SELECT instance.instance_id, definition.definition_type,
               definition.name AS definition_name, instance.lifecycle_status,
               instance.condition, instance.state, instance.location_id,
               instance.version::text, instance.simulation_version::text,
               instance.last_simulated_at, instance.next_simulation_at,
               policy.policy_id, policy.policy_version,
               policy.description AS policy_description,
               policy.minimum_interval_seconds, policy.maximum_elapsed_seconds,
               policy.state_keys, policy.resource_keys, policy.allowed_operation_types,
               policy.constraints
        FROM game.entity_instances instance
        JOIN game.entity_definitions definition
          ON definition.definition_id = instance.definition_id
        LEFT JOIN game.entity_simulation_policies policy
          ON policy.policy_id = instance.simulation_policy_id
         AND policy.status = 'active'
        WHERE instance.world_id = ${input.scope.worldId}
          AND instance.shard_id = ${input.scope.shardId}
          AND instance.instance_id = ${input.entityId}
        FOR UPDATE
      `;
      const entity = rows[0];
      if (!entity) throw new LazySimulationStoreError("entity_not_found", "Entity not found.");
      if (!entity.policy_id) {
        if (!input.forceIfRelevant) return null;
        throw new LazySimulationStoreError("policy_not_found", "Entity has no simulation policy.");
      }
      if (["dead", "destroyed", "retired", "merged"].includes(entity.lifecycle_status)) return null;
      const now = Date.now();
      const elapsedSeconds = Math.max(
        0,
        Math.min(
          entity.maximum_elapsed_seconds!,
          Math.floor((now - entity.last_simulated_at.getTime()) / 1_000),
        ),
      );
      const due = entity.next_simulation_at === null || entity.next_simulation_at.getTime() <= now;
      if (!due && !input.forceIfRelevant) return null;
      if (elapsedSeconds < entity.minimum_interval_seconds! && !input.forceIfRelevant) return null;
      const leased = await sql`
        UPDATE game.entity_instances
        SET simulation_lease_owner = ${input.leaseOwner},
            simulation_lease_expires_at = now() + interval '3 minutes',
            updated_at = now()
        WHERE world_id = ${input.scope.worldId}
          AND shard_id = ${input.scope.shardId}
          AND instance_id = ${input.entityId}
          AND (
            simulation_lease_expires_at IS NULL
            OR simulation_lease_expires_at < now()
            OR simulation_lease_owner = ${input.leaseOwner}
          )
        RETURNING instance_id
      `;
      if (!leased[0]) {
        throw new LazySimulationStoreError(
          "lease_conflict",
          "Entity simulation is already leased.",
        );
      }
      const idempotencyKey = runKey(
        entity.instance_id,
        Number(entity.simulation_version),
        entity.last_simulated_at,
      );
      const existing = await sql<{ run_id: string; status: string }[]>`
        SELECT run_id, status
        FROM game.entity_simulation_runs
        WHERE world_id = ${input.scope.worldId}
          AND idempotency_key = ${idempotencyKey}
      `;
      if (existing[0] && ["committed", "no_change"].includes(existing[0].status)) {
        await sql`
          UPDATE game.entity_instances
          SET simulation_lease_owner = NULL, simulation_lease_expires_at = NULL
          WHERE instance_id = ${input.entityId}
        `;
        return null;
      }
      const runId = existing[0]?.run_id || randomUUID();
      const request: LazySimulationRequest = {
        entityId: entity.instance_id,
        definitionType: entity.definition_type,
        definitionName: entity.definition_name,
        lifecycleStatus: entity.lifecycle_status,
        condition: entity.condition,
        state: { ...(entity.state || {}), version: Number(entity.version) },
        locationId: entity.location_id,
        elapsedSeconds,
        policy: {
          policyId: entity.policy_id,
          policyVersion: entity.policy_version!,
          description: entity.policy_description!,
          stateKeys: entity.state_keys || [],
          resourceKeys: SystemResourceKeySchema.array().parse(entity.resource_keys || []),
          allowedOperationTypes: entity.allowed_operation_types || [],
          constraints: entity.constraints || [],
        },
        relevantFacts: (input.relevantFacts || []).slice(0, 64),
        accessibleLocationIds: (input.accessibleLocationIds || []).slice(0, 64),
      };
      await sql`
        INSERT INTO game.entity_simulation_runs (
          run_id, world_id, shard_id, entity_instance_id, policy_id,
          idempotency_key, elapsed_seconds, starting_entity_version,
          starting_simulation_version, context_snapshot, status
        ) VALUES (
          ${runId}, ${input.scope.worldId}, ${input.scope.shardId},
          ${entity.instance_id}, ${entity.policy_id}, ${idempotencyKey},
          ${elapsedSeconds}, ${Number(entity.version)}, ${Number(entity.simulation_version)},
          ${json(request)}::jsonb, 'analyzing'
        )
        ON CONFLICT (world_id, idempotency_key) DO UPDATE
        SET status = CASE
          WHEN game.entity_simulation_runs.status = 'failed' THEN 'analyzing'
          ELSE game.entity_simulation_runs.status
        END,
        error_code = NULL
      `;
      return {
        runId,
        idempotencyKey,
        entityVersion: Number(entity.version),
        simulationVersion: Number(entity.simulation_version),
        request,
      };
    });
  }

  async function completeNoChange(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    claim: LazySimulationClaim;
    leaseOwner: string;
    proposal: Record<string, unknown>;
    nextSimulationSeconds: number;
  }): Promise<LazySimulationResult> {
    const next = new Date(Date.now() + input.nextSimulationSeconds * 1_000);
    await database.client.begin(async (sql) => {
      const updated = await sql`
        UPDATE game.entity_instances
        SET last_simulated_at = now(), next_simulation_at = ${next.toISOString()},
            simulation_version = simulation_version + 1,
            simulation_lease_owner = NULL, simulation_lease_expires_at = NULL,
            updated_at = now()
        WHERE world_id = ${input.scope.worldId}
          AND shard_id = ${input.scope.shardId}
          AND instance_id = ${input.claim.request.entityId}
          AND version = ${input.claim.entityVersion}
          AND simulation_version = ${input.claim.simulationVersion}
          AND simulation_lease_owner = ${input.leaseOwner}
          AND simulation_lease_expires_at >= now()
        RETURNING instance_id
      `;
      if (!updated[0])
        throw new LazySimulationStoreError("stale_entity", "Entity changed during simulation.");
      await sql`
        UPDATE game.entity_simulation_runs
        SET status = 'no_change', proposal = ${json(input.proposal)}::jsonb,
            completed_at = now()
        WHERE run_id = ${input.claim.runId}
      `;
    });
    return LazySimulationResultSchema.parse({
      runId: input.claim.runId,
      entityId: input.claim.request.entityId,
      status: "no_change",
      nextSimulationAt: next.toISOString(),
    });
  }

  async function completeCommitted(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    claim: LazySimulationClaim;
    leaseOwner: string;
    proposal: Record<string, unknown>;
    receiptId: string;
    eventId: string;
    nextSimulationSeconds: number;
  }): Promise<LazySimulationResult> {
    const next = new Date(Date.now() + input.nextSimulationSeconds * 1_000);
    await database.client.begin(async (sql) => {
      const updated = await sql`
        UPDATE game.entity_instances
        SET last_simulated_at = now(), next_simulation_at = ${next.toISOString()},
            simulation_version = simulation_version + 1,
            simulation_lease_owner = NULL, simulation_lease_expires_at = NULL,
            updated_at = now()
        WHERE world_id = ${input.scope.worldId}
          AND shard_id = ${input.scope.shardId}
          AND instance_id = ${input.claim.request.entityId}
          AND simulation_version = ${input.claim.simulationVersion}
          AND simulation_lease_owner = ${input.leaseOwner}
          AND simulation_lease_expires_at >= now()
        RETURNING instance_id
      `;
      if (!updated[0])
        throw new LazySimulationStoreError("stale_entity", "Entity simulation lease became stale.");
      await sql`
        UPDATE game.entity_simulation_runs
        SET status = 'committed', proposal = ${json(input.proposal)}::jsonb,
            result_receipt_id = ${input.receiptId}, result_event_id = ${input.eventId},
            completed_at = now()
        WHERE run_id = ${input.claim.runId}
      `;
    });
    return LazySimulationResultSchema.parse({
      runId: input.claim.runId,
      entityId: input.claim.request.entityId,
      status: "committed",
      eventId: input.eventId,
      receiptId: input.receiptId,
      nextSimulationAt: next.toISOString(),
    });
  }

  async function fail(input: {
    claim: LazySimulationClaim;
    leaseOwner: string;
    errorCode: string;
  }) {
    await database.client.begin(async (sql) => {
      await sql`
        UPDATE game.entity_instances
        SET simulation_lease_owner = NULL, simulation_lease_expires_at = NULL,
            next_simulation_at = now() + interval '15 minutes', updated_at = now()
        WHERE instance_id = ${input.claim.request.entityId}
          AND simulation_lease_owner = ${input.leaseOwner}
      `;
      await sql`
        UPDATE game.entity_simulation_runs
        SET status = 'failed', error_code = ${input.errorCode}, completed_at = now()
        WHERE run_id = ${input.claim.runId}
      `;
    });
  }

  return { claim, completeNoChange, completeCommitted, fail };
}

export type LazySimulationStore = ReturnType<typeof createLazySimulationStore>;
