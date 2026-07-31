import { createHash, randomUUID } from "node:crypto";
import type { UniversalOperationExecutor } from "./universal-operation-executor.js";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";
import type { WorldScope } from "./world-store.js";

export type LocationFamily =
  | "world"
  | "region"
  | "city"
  | "district"
  | "block"
  | "parcel"
  | "property"
  | "building"
  | "room"
  | "outdoor_area"
  | "road"
  | "interior_area"
  | "container";

export type LocationMaterializationSemantics = {
  normalizedFamily: LocationFamily;
  semanticType: string;
  name: string;
  conceptSummary: string;
  spatialCell: string;
  approximatePosition?: Record<string, unknown>;
  footprint?: Record<string, unknown>;
  accessPattern?: Record<string, unknown>;
  ownershipIdentity?: string;
  metadata?: Record<string, unknown>;
};

export class LocationMaterializationError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "parent_not_found"
      | "capacity_unavailable"
      | "request_conflict"
      | "registration_failed",
    message: string,
  ) {
    super(message);
    this.name = "LocationMaterializationError";
  }
}

const normalizeText = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

export function locationSemanticFingerprint(
  parentLocationId: string | null,
  semantics: LocationMaterializationSemantics,
) {
  const canonical = {
    parentLocationId,
    normalizedFamily: semantics.normalizedFamily,
    semanticType: normalizeText(semantics.semanticType),
    spatialCell: normalizeText(semantics.spatialCell),
    ownershipIdentity: semantics.ownershipIdentity
      ? normalizeText(semantics.ownershipIdentity)
      : null,
    name: normalizeText(semantics.name),
    conceptSummary: normalizeText(semantics.conceptSummary),
    footprint: semantics.footprint || {},
    accessPattern: semantics.accessPattern || {},
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function validateSemantics(semantics: LocationMaterializationSemantics) {
  if (
    !semantics.name.trim() ||
    !semantics.conceptSummary.trim() ||
    !semantics.semanticType.trim() ||
    !semantics.spatialCell.trim() ||
    semantics.name.length > 200 ||
    semantics.conceptSummary.length > 2_000 ||
    semantics.semanticType.length > 160 ||
    semantics.spatialCell.length > 200
  ) {
    throw new LocationMaterializationError("invalid_input", "Location semantics are invalid.");
  }
}

export function createLocationMaterializationStore(
  database: ReturnType<typeof createDatabase>,
  executor: UniversalOperationExecutor,
) {
  async function findCompatible(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    parentLocationId: string | null;
    semantics: LocationMaterializationSemantics;
  }) {
    validateSemantics(input.semantics);
    const fingerprint = locationSemanticFingerprint(input.parentLocationId, input.semantics);
    const exact = await database.client<
      {
        location_instance_id: string;
        semantic_type: string;
        materialization_status: string;
      }[]
    >`
      SELECT location_instance_id, semantic_type, materialization_status
      FROM game.location_profiles
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND parent_location_id IS NOT DISTINCT FROM ${input.parentLocationId}
        AND spatial_cell = ${input.semantics.spatialCell}
        AND normalized_family = ${input.semantics.normalizedFamily}
        AND semantic_fingerprint = ${fingerprint}
        AND materialization_status IN ('provisional', 'durable')
      LIMIT 1
    `;
    if (exact[0]) {
      return {
        kind: "exact" as const,
        locationId: exact[0].location_instance_id,
        semanticType: exact[0].semantic_type,
        fingerprint,
      };
    }

    const candidates = await database.client<
      {
        location_instance_id: string;
        semantic_type: string;
        ownership_identity: string | null;
        semantic_fingerprint: string;
      }[]
    >`
      SELECT location_instance_id, semantic_type, ownership_identity, semantic_fingerprint
      FROM game.location_profiles
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND parent_location_id IS NOT DISTINCT FROM ${input.parentLocationId}
        AND spatial_cell = ${input.semantics.spatialCell}
        AND normalized_family = ${input.semantics.normalizedFamily}
        AND materialization_status IN ('provisional', 'durable')
      ORDER BY updated_at DESC
      LIMIT 12
    `;
    return {
      kind: "candidates" as const,
      fingerprint,
      candidates: candidates.map((candidate) => ({
        locationId: candidate.location_instance_id,
        semanticType: candidate.semantic_type,
        ownershipIdentity: candidate.ownership_identity,
        fingerprint: candidate.semantic_fingerprint,
      })),
    };
  }

  async function reserveCapacity(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    areaId: string;
    capacityKey: string;
    units?: number;
  }) {
    const units = input.units ?? 1;
    if (!Number.isFinite(units) || units <= 0) {
      throw new LocationMaterializationError("invalid_input", "Capacity units must be positive.");
    }
    const rows = await database.client<{ version: string; units_available: string }[]>`
      UPDATE game.location_capacities
      SET units_available = units_available - ${units},
          version = version + 1,
          updated_at = now()
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND area_instance_id = ${input.areaId}
        AND capacity_key = ${input.capacityKey}
        AND units_available >= ${units}
      RETURNING version::text, units_available::text
    `;
    if (!rows[0]) {
      throw new LocationMaterializationError(
        "capacity_unavailable",
        "Location materialization capacity is unavailable.",
      );
    }
    return {
      version: Number(rows[0].version),
      unitsAvailable: Number(rows[0].units_available),
    };
  }

  async function refundCapacity(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    areaId: string;
    capacityKey: string;
    units?: number;
  }) {
    const units = input.units ?? 1;
    await database.client`
      UPDATE game.location_capacities
      SET units_available = LEAST(maximum_units, units_available + ${units}),
          version = version + 1,
          updated_at = now()
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND area_instance_id = ${input.areaId}
        AND capacity_key = ${input.capacityKey}
    `;
  }

  async function registerProfile(input: {
    scope: Pick<WorldScope, "worldId" | "shardId">;
    locationId: string;
    parentLocationId: string | null;
    semantics: LocationMaterializationSemantics;
    sourceEventId: string;
    fingerprint?: string;
  }) {
    const fingerprint =
      input.fingerprint || locationSemanticFingerprint(input.parentLocationId, input.semantics);
    const rows = await database.client<{ location_instance_id: string }[]>`
      INSERT INTO game.location_profiles (
        location_instance_id, world_id, shard_id, parent_location_id,
        normalized_family, semantic_type, spatial_cell, approximate_position,
        footprint, access_pattern, ownership_identity, semantic_fingerprint,
        materialization_status, source_event_id, metadata
      )
      SELECT
        instance.instance_id, ${input.scope.worldId}, ${input.scope.shardId},
        ${input.parentLocationId}, ${input.semantics.normalizedFamily},
        ${input.semantics.semanticType}, ${input.semantics.spatialCell},
        ${json(input.semantics.approximatePosition || {})}::jsonb,
        ${json(input.semantics.footprint || {})}::jsonb,
        ${json(input.semantics.accessPattern || {})}::jsonb,
        ${input.semantics.ownershipIdentity || null}, ${fingerprint}, 'durable',
        ${input.sourceEventId}, ${json(input.semantics.metadata || {})}::jsonb
      FROM game.entity_instances instance
      WHERE instance.world_id = ${input.scope.worldId}
        AND instance.shard_id = ${input.scope.shardId}
        AND instance.instance_id = ${input.locationId}
      ON CONFLICT DO NOTHING
      RETURNING location_instance_id
    `;
    return rows[0]
      ? { registered: true as const, fingerprint }
      : { registered: false as const, fingerprint };
  }

  async function materialize(input: {
    scope: WorldScope;
    actorId?: string;
    idempotencyKey: string;
    parentLocationId: string | null;
    capacityAreaId: string;
    capacityKey?: string;
    semantics: LocationMaterializationSemantics;
    preconditionFactIds: string[];
  }) {
    validateSemantics(input.semantics);
    const fingerprint = locationSemanticFingerprint(input.parentLocationId, input.semantics);
    const requestId = randomUUID();
    const existingRequests = await database.client<
      {
        request_id: string;
        status: string;
        reused_location_id: string | null;
        materialized_location_id: string | null;
        semantic_fingerprint: string;
      }[]
    >`
      INSERT INTO game.location_materialization_requests (
        request_id, world_id, shard_id, idempotency_key, parent_location_id,
        requested_semantics, semantic_fingerprint, capacity_key, status
      ) VALUES (
        ${requestId}, ${input.scope.worldId}, ${input.scope.shardId},
        ${input.idempotencyKey}, ${input.parentLocationId},
        ${json(input.semantics)}::jsonb, ${fingerprint},
        ${input.capacityKey || "minor_location"}, 'pending'
      )
      ON CONFLICT (world_id, idempotency_key) DO UPDATE
      SET idempotency_key = EXCLUDED.idempotency_key
      RETURNING request_id, status, reused_location_id,
                materialized_location_id, semantic_fingerprint
    `;
    const request = existingRequests[0];
    if (!request) {
      throw new LocationMaterializationError("request_conflict", "Materialization request failed.");
    }
    if (request.semantic_fingerprint !== fingerprint) {
      throw new LocationMaterializationError(
        "request_conflict",
        "Idempotency key was used for different location semantics.",
      );
    }
    if (request.status === "reused" && request.reused_location_id) {
      return {
        kind: "reused" as const,
        locationId: request.reused_location_id,
        requestId: request.request_id,
      };
    }
    if (request.status === "materialized" && request.materialized_location_id) {
      return {
        kind: "materialized" as const,
        locationId: request.materialized_location_id,
        requestId: request.request_id,
      };
    }

    const compatible = await findCompatible({
      scope: input.scope,
      parentLocationId: input.parentLocationId,
      semantics: input.semantics,
    });
    if (compatible.kind === "exact") {
      await database.client`
        UPDATE game.location_materialization_requests
        SET status = 'reused', reused_location_id = ${compatible.locationId},
            completed_at = now()
        WHERE request_id = ${request.request_id} AND status = 'pending'
      `;
      return {
        kind: "reused" as const,
        locationId: compatible.locationId,
        requestId: request.request_id,
      };
    }

    const capacityKey = input.capacityKey || "minor_location";
    await reserveCapacity({
      scope: input.scope,
      areaId: input.capacityAreaId,
      capacityKey,
    });

    try {
      const receipt = await executor.execute({
        scope: input.scope,
        authority: input.actorId ? "player" : "world_simulation",
        actorId: input.actorId,
        idempotencyKey: `${input.idempotencyKey}:world-mutation`,
        declaredFactIds: input.preconditionFactIds,
        playerVisibleFacts: [`A persistent location was established: ${input.semantics.name}.`],
        hiddenFacts: [],
        branch: {
          operations: [
            {
              type: "create_definition",
              symbol: "location_definition",
              definitionType: "location",
              name: input.semantics.name,
              conceptSummary: input.semantics.conceptSummary,
              originSource: "dynamic_geography",
              lifecycleStatus: "approved",
              preconditionFactIds: input.preconditionFactIds,
            },
            {
              type: "create_revision",
              symbol: "location_revision",
              definitionRef: { kind: "symbol", symbol: "location_definition" },
              schemaVersion: "location-v1",
              payload: {
                definitionType: "location",
                name: input.semantics.name,
                conceptSummary: input.semantics.conceptSummary,
                extensionPayload: {
                  normalizedFamily: input.semantics.normalizedFamily,
                  semanticType: input.semantics.semanticType,
                  spatialCell: input.semantics.spatialCell,
                  approximatePosition: input.semantics.approximatePosition || {},
                  footprint: input.semantics.footprint || {},
                  accessPattern: input.semantics.accessPattern || {},
                },
              },
              changeSummary: "Materialize persistent shared-world location",
              preconditionFactIds: input.preconditionFactIds,
            },
            {
              type: "create_instance",
              symbol: "location_instance",
              definitionRef: { kind: "symbol", symbol: "location_definition" },
              ...(input.parentLocationId
                ? {
                    locationRef: {
                      kind: "existing" as const,
                      entityId: input.parentLocationId,
                    },
                  }
                : {}),
              condition: 100,
              state: {
                locationProfile: {
                  normalizedFamily: input.semantics.normalizedFamily,
                  semanticType: input.semantics.semanticType,
                  spatialCell: input.semantics.spatialCell,
                  semanticFingerprint: fingerprint,
                },
              },
              provenance: {
                sourceType: "ai_materialization",
                sourceId: request.request_id,
                policyVersion: "location-materialization-v1",
                inputHash: fingerprint,
                payload: { capacityAreaId: input.capacityAreaId, capacityKey },
              },
              preconditionFactIds: input.preconditionFactIds,
            },
            ...(input.parentLocationId
              ? [
                  {
                    type: "set_relation" as const,
                    sourceRef: { kind: "symbol" as const, symbol: "location_instance" },
                    targetRef: {
                      kind: "existing" as const,
                      entityId: input.parentLocationId,
                    },
                    relationType: "located_within",
                    parameters: { visibility: "player_known" },
                    preconditionFactIds: input.preconditionFactIds,
                  },
                ]
              : []),
          ],
        },
      });
      const locationId = receipt.symbolMap.location_instance;
      if (!locationId) {
        throw new LocationMaterializationError(
          "registration_failed",
          "Location mutation did not return an instance.",
        );
      }
      const registration = await registerProfile({
        scope: input.scope,
        locationId,
        parentLocationId: input.parentLocationId,
        semantics: input.semantics,
        sourceEventId: receipt.eventId,
        fingerprint,
      });
      if (!registration.registered) {
        const winner = await findCompatible({
          scope: input.scope,
          parentLocationId: input.parentLocationId,
          semantics: input.semantics,
        });
        if (winner.kind !== "exact") {
          throw new LocationMaterializationError(
            "registration_failed",
            "Location profile could not be registered or deduplicated.",
          );
        }
        await executor.execute({
          scope: input.scope,
          authority: "world_simulation",
          idempotencyKey: `${input.idempotencyKey}:dedupe-compensation`,
          declaredFactIds: [],
          branch: {
            operations: [
              {
                type: "retire_entity",
                entityRef: { kind: "existing", entityId: locationId },
                expectedVersion: 0,
                lifecycleStatus: "merged",
                reason: "Concurrent materialization matched an existing location.",
                survivingEntityRef: { kind: "existing", entityId: winner.locationId },
                preconditionFactIds: [],
              },
            ],
          },
        });
        await database.client`
          UPDATE game.location_materialization_requests
          SET status = 'reused', reused_location_id = ${winner.locationId},
              source_event_id = ${receipt.eventId}, completed_at = now()
          WHERE request_id = ${request.request_id}
        `;
        await refundCapacity({
          scope: input.scope,
          areaId: input.capacityAreaId,
          capacityKey,
        });
        return {
          kind: "reused" as const,
          locationId: winner.locationId,
          requestId: request.request_id,
        };
      }

      await database.client`
        UPDATE game.location_materialization_requests
        SET status = 'materialized', materialized_location_id = ${locationId},
            source_event_id = ${receipt.eventId}, completed_at = now()
        WHERE request_id = ${request.request_id}
      `;
      return { kind: "materialized" as const, locationId, requestId: request.request_id };
    } catch (error) {
      await refundCapacity({
        scope: input.scope,
        areaId: input.capacityAreaId,
        capacityKey,
      }).catch(() => {});
      await database.client`
        UPDATE game.location_materialization_requests
        SET status = 'failed', rejection_reason = ${error instanceof Error ? error.message : String(error)}
        WHERE request_id = ${request.request_id} AND status = 'pending'
      `.catch(() => {});
      throw error;
    }
  }

  return {
    findCompatible,
    reserveCapacity,
    refundCapacity,
    registerProfile,
    materialize,
  };
}

export type LocationMaterializationStore = ReturnType<typeof createLocationMaterializationStore>;
