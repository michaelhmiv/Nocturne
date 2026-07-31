import { createHash, randomUUID } from "node:crypto";
import {
  UniversalMutationReceiptSchema,
  UniversalWorldOperationBranchSchema,
  type UniversalMutationReceipt,
  type UniversalWorldOperation,
  type WorldDefinitionReference,
  type WorldEntityReference,
} from "@nocturne/contracts";
import type { TransactionSql } from "postgres";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";
import type { WorldScope } from "./world-store.js";

export type UniversalOperationAuthority = "player" | "scheduled" | "world_simulation" | "operator";

export type UniversalOperationExecutionInput = {
  scope: Pick<WorldScope, "worldId" | "shardId" | "userId" | "role">;
  authority: UniversalOperationAuthority;
  idempotencyKey: string;
  actorId?: string;
  sourceIntentId?: string;
  sourcePlanId?: string;
  sourceStepId?: string;
  declaredFactIds: string[];
  branch: unknown;
  playerVisibleFacts?: string[];
  hiddenFacts?: string[];
};

export class UniversalOperationError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "forbidden"
      | "entity_not_found"
      | "definition_not_found"
      | "cross_world_reference"
      | "unmet_precondition"
      | "stale_entity"
      | "invalid_location"
      | "containment_cycle"
      | "invalid_operation"
      | "idempotency_conflict",
    message: string,
  ) {
    super(message);
    this.name = "UniversalOperationError";
  }
}

type SymbolMaps = {
  entities: Map<string, string>;
  definitions: Map<string, string>;
  revisions: Map<string, string>;
  schedules: Map<string, string>;
  areaEffects: Map<string, string>;
};

type ExistingEntityRow = {
  instance_id: string;
  owner_id: string | null;
  controller_id: string | null;
  location_id: string | null;
  condition: number;
  version: string;
  lifecycle_status: string;
  state: Record<string, unknown>;
};

type ExecutorDependencies = {
  validateCurrentFacts?(input: {
    scope: UniversalOperationExecutionInput["scope"];
    actorId?: string;
    factIds: string[];
  }): Promise<void>;
};

const terminalStatuses = new Set(["dead", "destroyed", "retired", "merged"]);
const controlledRelationTypes = new Set(["possessed_by", "contained_in", "located_within"]);

const hashRequest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

function validateExecutionInput(input: UniversalOperationExecutionInput) {
  if (
    !input.idempotencyKey ||
    input.idempotencyKey.trim() !== input.idempotencyKey ||
    input.idempotencyKey.length > 240 ||
    new Set(input.declaredFactIds).size !== input.declaredFactIds.length ||
    input.declaredFactIds.some(
      (factId) =>
        !factId || factId.trim() !== factId || factId.length > 160,
    )
  ) {
    throw new UniversalOperationError("invalid_input", "Invalid universal operation input.");
  }
  if (input.authority === "player" && (!input.actorId || !input.scope.userId)) {
    throw new UniversalOperationError("forbidden", "Player mutations require an actor and user.");
  }
  if (input.authority === "operator" && !["operator", "owner"].includes(input.scope.role)) {
    throw new UniversalOperationError("forbidden", "Operator authority is required.");
  }
  try {
    return UniversalWorldOperationBranchSchema.parse(input.branch);
  } catch (error) {
    throw new UniversalOperationError(
      "invalid_input",
      error instanceof Error ? error.message : "Invalid universal operation branch.",
    );
  }
}

function allPreconditionFactIds(operations: UniversalWorldOperation[]) {
  return [...new Set(operations.flatMap((operation) => operation.preconditionFactIds))];
}

function entityRefs(operation: UniversalWorldOperation): WorldEntityReference[] {
  switch (operation.type) {
    case "create_instance":
      return [operation.locationRef, operation.ownerRef, operation.controllerRef].filter(
        (value): value is WorldEntityReference => Boolean(value),
      );
    case "retire_entity":
      return [operation.entityRef, operation.survivingEntityRef].filter(
        (value): value is WorldEntityReference => Boolean(value),
      );
    case "move_entity":
      return [operation.entityRef, operation.locationRef, operation.expectedLocationRef].filter(
        (value): value is WorldEntityReference => Boolean(value),
      );
    case "transfer_ownership":
      return [operation.entityRef, operation.ownerRef].filter(
        (value): value is WorldEntityReference => Boolean(value),
      );
    case "transfer_possession":
      return [operation.entityRef, operation.possessorRef].filter(
        (value): value is WorldEntityReference => Boolean(value),
      );
    case "set_controller":
      return [operation.entityRef, operation.controllerRef].filter(
        (value): value is WorldEntityReference => Boolean(value),
      );
    case "set_relation":
    case "remove_relation":
      return [operation.sourceRef, operation.targetRef];
    case "set_access":
      return [operation.subjectRef, operation.resourceRef];
    case "set_condition":
    case "adjust_condition":
    case "adjust_resource":
    case "set_state_value":
    case "remove_state_value":
      return [operation.entityRef];
    case "create_information_asset":
      return [operation.holderRef, operation.subjectRef].filter(
        (value): value is WorldEntityReference => Boolean(value),
      );
    case "schedule_timed_work":
      return operation.subjectRefs;
    case "apply_area_effect":
      return [operation.areaRef];
    default:
      return [];
  }
}

function collectExistingEntityIds(operations: UniversalWorldOperation[]) {
  const ids = new Set<string>();
  for (const operation of operations) {
    for (const reference of entityRefs(operation)) {
      if (reference.kind === "existing") ids.add(reference.entityId);
    }
  }
  return [...ids].sort();
}

function resolveEntityRef(reference: WorldEntityReference, symbols: SymbolMaps) {
  if (reference.kind === "existing") return reference.entityId;
  const entityId = symbols.entities.get(reference.symbol);
  if (!entityId) {
    throw new UniversalOperationError(
      "invalid_operation",
      `Entity symbol ${reference.symbol} is not available at this operation.`,
    );
  }
  return entityId;
}

function resolveNullableEntityRef(
  reference: WorldEntityReference | null | undefined,
  symbols: SymbolMaps,
) {
  return reference ? resolveEntityRef(reference, symbols) : null;
}

function resolveDefinitionRef(reference: WorldDefinitionReference, symbols: SymbolMaps) {
  if (reference.kind === "existing") return reference.definitionId;
  const definitionId = symbols.definitions.get(reference.symbol);
  if (!definitionId) {
    throw new UniversalOperationError(
      "invalid_operation",
      `Definition symbol ${reference.symbol} is not available at this operation.`,
    );
  }
  return definitionId;
}

async function requireEntity(
  sql: TransactionSql,
  input: UniversalOperationExecutionInput,
  entityId: string,
  cache: Map<string, ExistingEntityRow>,
): Promise<ExistingEntityRow> {
  const cached = cache.get(entityId);
  if (cached) return cached;
  const rows = await sql<ExistingEntityRow[]>`
    SELECT instance_id, owner_id, controller_id, location_id, condition,
           version::text, lifecycle_status, state
    FROM game.entity_instances
    WHERE world_id = ${input.scope.worldId}
      AND shard_id = ${input.scope.shardId}
      AND instance_id = ${entityId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    const anywhere = await sql`
      SELECT 1 FROM game.entity_instances WHERE instance_id = ${entityId}
    `;
    throw new UniversalOperationError(
      anywhere[0] ? "cross_world_reference" : "entity_not_found",
      anywhere[0] ? "Entity is outside the active world or shard." : "Entity not found.",
    );
  }
  cache.set(entityId, row);
  return row;
}

function requireExpectedVersion(row: ExistingEntityRow, expectedVersion: number | undefined) {
  if (expectedVersion !== undefined && Number(row.version) !== expectedVersion) {
    throw new UniversalOperationError("stale_entity", "Entity version precondition is stale.");
  }
}

async function requireDefinition(
  sql: TransactionSql,
  worldId: string,
  definitionId: string,
) {
  const rows = await sql`
    SELECT definition_id
    FROM game.entity_definitions
    WHERE definition_id = ${definitionId}
      AND (world_id = ${worldId} OR world_id IS NULL)
  `;
  if (!rows[0]) {
    const anywhere = await sql`
      SELECT 1 FROM game.entity_definitions WHERE definition_id = ${definitionId}
    `;
    throw new UniversalOperationError(
      anywhere[0] ? "cross_world_reference" : "definition_not_found",
      anywhere[0] ? "Definition is outside the active world." : "Definition not found.",
    );
  }
}

async function requirePlayerAuthority(
  sql: TransactionSql,
  input: UniversalOperationExecutionInput,
  cache: Map<string, ExistingEntityRow>,
  operations: UniversalWorldOperation[],
) {
  if (input.authority !== "player") return;
  const actorId = input.actorId!;
  const actor = await requireEntity(sql, input, actorId, cache);
  if (terminalStatuses.has(actor.lifecycle_status)) {
    throw new UniversalOperationError("forbidden", "Terminal actors cannot perform actions.");
  }
  const controlled = await sql`
    SELECT 1
    FROM game.player_characters
    WHERE world_id = ${input.scope.worldId}
      AND user_id = ${input.scope.userId}
      AND character_instance_id = ${actorId}
  `;
  if (!controlled[0]) {
    throw new UniversalOperationError("forbidden", "Actor is not controlled by this user.");
  }

  for (const operation of operations) {
    for (const reference of entityRefs(operation)) {
      if (reference.kind !== "existing" || reference.entityId === actorId) continue;
      const target = await requireEntity(sql, input, reference.entityId, cache);
      const directlyControlled = target.owner_id === actorId || target.controller_id === actorId;
      if (!directlyControlled && operation.preconditionFactIds.length === 0) {
        throw new UniversalOperationError(
          "forbidden",
          "Effects on uncontrolled entities require current authoritative preconditions.",
        );
      }
    }
  }
}

async function ensureNoContainmentCycle(
  sql: TransactionSql,
  input: UniversalOperationExecutionInput,
  entityId: string,
  locationId: string,
) {
  if (entityId === locationId) {
    throw new UniversalOperationError("containment_cycle", "Entity cannot contain itself.");
  }
  const rows = await sql`
    WITH RECURSIVE descendants(instance_id) AS (
      SELECT instance_id
      FROM game.entity_instances
      WHERE world_id = ${input.scope.worldId}
        AND shard_id = ${input.scope.shardId}
        AND location_id = ${entityId}
      UNION
      SELECT child.instance_id
      FROM game.entity_instances child
      JOIN descendants parent ON child.location_id = parent.instance_id
      WHERE child.world_id = ${input.scope.worldId}
        AND child.shard_id = ${input.scope.shardId}
    )
    SELECT 1 FROM descendants WHERE instance_id = ${locationId} LIMIT 1
  `;
  if (rows[0]) {
    throw new UniversalOperationError(
      "containment_cycle",
      "Movement would create a containment cycle.",
    );
  }
}

function publicSymbolMap(symbols: SymbolMaps) {
  return Object.fromEntries([
    ...symbols.entities,
    ...symbols.definitions,
    ...symbols.revisions,
    ...symbols.schedules,
    ...symbols.areaEffects,
  ]);
}

export function createUniversalOperationExecutor(
  database: ReturnType<typeof createDatabase>,
  dependencies: ExecutorDependencies = {},
) {
  async function findReplay(
    worldId: string,
    idempotencyKey: string,
    requestHash: string,
  ): Promise<UniversalMutationReceipt | null> {
    const rows = await database.client<
      {
        receipt_id: string;
        event_id: string;
        world_id: string;
        shard_id: string;
        idempotency_key: string;
        request_hash: string;
        authority: UniversalOperationAuthority;
        actor_id: string | null;
        symbol_map: Record<string, string>;
        player_visible_facts: string[];
        hidden_facts: string[];
        created_at: Date;
      }[]
    >`
      SELECT receipt_id, event_id, world_id, shard_id, idempotency_key,
             request_hash, authority, actor_id, symbol_map,
             player_visible_facts, hidden_facts, created_at
      FROM game.mutation_receipts
      WHERE world_id = ${worldId} AND idempotency_key = ${idempotencyKey}
    `;
    const row = rows[0];
    if (!row) return null;
    if (row.request_hash !== requestHash) {
      throw new UniversalOperationError(
        "idempotency_conflict",
        "Idempotency key was already used for another mutation request.",
      );
    }
    const resultRows = await database.client<{ result: Record<string, unknown> }[]>`
      SELECT result
      FROM game.mutation_operation_results
      WHERE receipt_id = ${row.receipt_id}
      ORDER BY operation_order
    `;
    return UniversalMutationReceiptSchema.parse({
      receiptId: row.receipt_id,
      eventId: row.event_id,
      worldId: row.world_id,
      shardId: row.shard_id,
      idempotencyKey: row.idempotency_key,
      requestHash: row.request_hash,
      authority: row.authority,
      actorId: row.actor_id || undefined,
      symbolMap: row.symbol_map || {},
      operationResults: resultRows.map(({ result }) => result),
      playerVisibleFacts: row.player_visible_facts || [],
      hiddenFacts: row.hidden_facts || [],
      createdAt: row.created_at.toISOString(),
      idempotentReplay: true,
    });
  }

  async function execute(input: UniversalOperationExecutionInput): Promise<UniversalMutationReceipt> {
    const branch = validateExecutionInput(input);
    const declared = new Set(input.declaredFactIds);
    const requiredFactIds = allPreconditionFactIds(branch.operations);
    if (requiredFactIds.some((factId) => !declared.has(factId))) {
      throw new UniversalOperationError(
        "unmet_precondition",
        "Operation precondition was not declared by the authoritative plan.",
      );
    }
    await dependencies.validateCurrentFacts?.({
      scope: input.scope,
      actorId: input.actorId,
      factIds: requiredFactIds,
    });

    const requestPayload = {
      authority: input.authority,
      actorId: input.actorId || null,
      sourceIntentId: input.sourceIntentId || null,
      sourcePlanId: input.sourcePlanId || null,
      sourceStepId: input.sourceStepId || null,
      declaredFactIds: input.declaredFactIds,
      branch,
      playerVisibleFacts: input.playerVisibleFacts || [],
      hiddenFacts: input.hiddenFacts || [],
    };
    const requestHash = hashRequest(requestPayload);
    const replay = await findReplay(input.scope.worldId, input.idempotencyKey, requestHash);
    if (replay) return replay;

    try {
      return await database.client.begin(async (sql) => {
        await sql`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
        const existingReceipts = await sql<{ request_hash: string }[]>`
          SELECT request_hash
          FROM game.mutation_receipts
          WHERE world_id = ${input.scope.worldId}
            AND idempotency_key = ${input.idempotencyKey}
          FOR UPDATE
        `;
        if (existingReceipts[0]) {
          if (existingReceipts[0].request_hash !== requestHash) {
            throw new UniversalOperationError(
              "idempotency_conflict",
              "Idempotency key was already used for another mutation request.",
            );
          }
          throw new UniversalOperationError(
            "idempotency_conflict",
            "Mutation was committed concurrently; retry to retrieve its receipt.",
          );
        }

        const entityCache = new Map<string, ExistingEntityRow>();
        for (const entityId of collectExistingEntityIds(branch.operations)) {
          await requireEntity(sql, input, entityId, entityCache);
        }
        await requirePlayerAuthority(sql, input, entityCache, branch.operations);

        const eventId = randomUUID();
        const receiptId = randomUUID();
        const createdAt = new Date().toISOString();
        const symbols: SymbolMaps = {
          entities: new Map(),
          definitions: new Map(),
          revisions: new Map(),
          schedules: new Map(),
          areaEffects: new Map(),
        };
        const operationResults: Record<string, unknown>[] = [];
        const involvedEntityIds = new Set<string>([
          ...(input.actorId ? [input.actorId] : []),
          ...collectExistingEntityIds(branch.operations),
        ]);

        await sql`
          INSERT INTO game.event_ledger (
            event_id, world_id, shard_id, idempotency_key, world_time,
            event_type, involved_entity_ids, payload, source_intent_id
          ) VALUES (
            ${eventId}, ${input.scope.worldId}, ${input.scope.shardId},
            ${input.idempotencyKey}, now(), 'world_mutation', '[]'::jsonb,
            ${json({ status: "applying", requestHash })}::jsonb,
            ${input.sourceIntentId || null}
          )
        `;

        for (const [index, operation] of branch.operations.entries()) {
          const order = index + 1;
          let result: Record<string, unknown>;
          switch (operation.type) {
            case "create_definition": {
              const definitionId = `GEN-${randomUUID()}`;
              await sql`
                INSERT INTO game.entity_definitions (
                  definition_id, world_id, definition_type, name, concept_summary,
                  origin_source, lifecycle_status
                ) VALUES (
                  ${definitionId}, ${input.scope.worldId}, ${operation.definitionType},
                  ${operation.name}, ${operation.conceptSummary},
                  ${operation.originSource || null}, ${operation.lifecycleStatus}
                )
              `;
              symbols.definitions.set(operation.symbol, definitionId);
              result = { order, type: operation.type, definitionId, symbol: operation.symbol };
              break;
            }
            case "create_revision": {
              const definitionId = resolveDefinitionRef(operation.definitionRef, symbols);
              await requireDefinition(sql, input.scope.worldId, definitionId);
              const revisionId = randomUUID();
              await sql`
                INSERT INTO game.definition_revisions (
                  revision_id, world_id, definition_id, schema_version,
                  payload, change_summary, created_by
                ) VALUES (
                  ${revisionId}, ${input.scope.worldId}, ${definitionId},
                  ${operation.schemaVersion}, ${json(operation.payload)}::jsonb,
                  ${operation.changeSummary}, ${input.actorId || null}
                )
              `;
              await sql`
                UPDATE game.entity_definitions
                SET current_revision_id = ${revisionId}, updated_at = now()
                WHERE definition_id = ${definitionId}
                  AND world_id = ${input.scope.worldId}
              `;
              if (operation.symbol) symbols.revisions.set(operation.symbol, revisionId);
              result = {
                order,
                type: operation.type,
                definitionId,
                revisionId,
                ...(operation.symbol ? { symbol: operation.symbol } : {}),
              };
              break;
            }
            case "create_instance": {
              const definitionId = resolveDefinitionRef(operation.definitionRef, symbols);
              await requireDefinition(sql, input.scope.worldId, definitionId);
              const locationId = resolveNullableEntityRef(operation.locationRef, symbols);
              const ownerId = resolveNullableEntityRef(operation.ownerRef, symbols);
              const controllerId = resolveNullableEntityRef(operation.controllerRef, symbols);
              for (const referencedId of [locationId, ownerId, controllerId].filter(
                (value): value is string => Boolean(value),
              )) {
                await requireEntity(sql, input, referencedId, entityCache);
              }
              const entityId = randomUUID();
              await sql`
                INSERT INTO game.entity_instances (
                  instance_id, world_id, shard_id, definition_id, owner_id,
                  controller_id, location_id, condition, state, created_event_id,
                  version, lifecycle_status, provenance, last_simulated_at
                ) VALUES (
                  ${entityId}, ${input.scope.worldId}, ${input.scope.shardId},
                  ${definitionId}, ${ownerId}, ${controllerId}, ${locationId},
                  ${operation.condition}, ${json(operation.state)}::jsonb, ${eventId},
                  0, 'active', ${json(operation.provenance)}::jsonb, now()
                )
              `;
              await sql`
                INSERT INTO game.entity_provenance (
                  world_id, entity_instance_id, source_type, source_id,
                  policy_version, input_hash, payload, created_event_id
                ) VALUES (
                  ${input.scope.worldId}, ${entityId}, ${operation.provenance.sourceType},
                  ${operation.provenance.sourceId || null},
                  ${operation.provenance.policyVersion || null},
                  ${operation.provenance.inputHash || null},
                  ${json(operation.provenance.payload)}::jsonb, ${eventId}
                )
              `;
              const definitionRows = await sql<{ name: string }[]>`
                SELECT name FROM game.entity_definitions WHERE definition_id = ${definitionId}
              `;
              if (definitionRows[0]?.name) {
                await sql`
                  INSERT INTO game.entity_aliases (
                    world_id, entity_instance_id, alias_text, alias_type,
                    confidence, source_event_id, metadata
                  ) VALUES (
                    ${input.scope.worldId}, ${entityId}, ${definitionRows[0].name},
                    'descriptive', 1, ${eventId}, '{"createdWithInstance":true}'::jsonb
                  )
                  ON CONFLICT DO NOTHING
                `;
              }
              symbols.entities.set(operation.symbol, entityId);
              involvedEntityIds.add(entityId);
              result = {
                order,
                type: operation.type,
                entityId,
                definitionId,
                locationId,
                ownerId,
                controllerId,
                version: 0,
                symbol: operation.symbol,
              };
              break;
            }
            case "retire_entity": {
              const entityId = resolveEntityRef(operation.entityRef, symbols);
              const row = await requireEntity(sql, input, entityId, entityCache);
              requireExpectedVersion(row, operation.expectedVersion);
              if (terminalStatuses.has(row.lifecycle_status)) {
                throw new UniversalOperationError(
                  "invalid_operation",
                  "Entity is already in a terminal lifecycle state.",
                );
              }
              const survivingEntityId = resolveNullableEntityRef(
                operation.survivingEntityRef,
                symbols,
              );
              if ((operation.lifecycleStatus === "merged") !== Boolean(survivingEntityId)) {
                throw new UniversalOperationError(
                  "invalid_operation",
                  "Merged entities require exactly one surviving entity.",
                );
              }
              if (survivingEntityId) {
                if (survivingEntityId === entityId) {
                  throw new UniversalOperationError(
                    "invalid_operation",
                    "Entity cannot merge into itself.",
                  );
                }
                await requireEntity(sql, input, survivingEntityId, entityCache);
              }
              const updated = await sql<{ version: string }[]>`
                UPDATE game.entity_instances
                SET lifecycle_status = ${operation.lifecycleStatus},
                    retired_at = now(),
                    retired_event_id = ${eventId},
                    version = version + 1,
                    updated_at = now()
                WHERE world_id = ${input.scope.worldId}
                  AND shard_id = ${input.scope.shardId}
                  AND instance_id = ${entityId}
                  AND version = ${operation.expectedVersion}
                RETURNING version::text
              `;
              if (!updated[0]) {
                throw new UniversalOperationError("stale_entity", "Entity changed before retirement.");
              }
              await sql`
                INSERT INTO game.entity_tombstones (
                  world_id, entity_instance_id, lifecycle_status,
                  surviving_entity_id, reason, event_id
                ) VALUES (
                  ${input.scope.worldId}, ${entityId}, ${operation.lifecycleStatus},
                  ${survivingEntityId}, ${operation.reason}, ${eventId}
                )
              `;
              result = {
                order,
                type: operation.type,
                entityId,
                lifecycleStatus: operation.lifecycleStatus,
                survivingEntityId,
                version: Number(updated[0].version),
              };
              break;
            }
            case "move_entity": {
              const entityId = resolveEntityRef(operation.entityRef, symbols);
              const locationId = resolveEntityRef(operation.locationRef, symbols);
              const row = await requireEntity(sql, input, entityId, entityCache);
              await requireEntity(sql, input, locationId, entityCache);
              requireExpectedVersion(row, operation.expectedVersion);
              if (terminalStatuses.has(row.lifecycle_status) && row.lifecycle_status !== "dead") {
                throw new UniversalOperationError(
                  "invalid_operation",
                  "Destroyed, retired, or merged entities cannot be moved normally.",
                );
              }
              const expectedLocationId =
                operation.expectedLocationRef === undefined
                  ? undefined
                  : resolveNullableEntityRef(operation.expectedLocationRef, symbols);
              if (
                expectedLocationId !== undefined &&
                row.location_id !== expectedLocationId
              ) {
                throw new UniversalOperationError("stale_entity", "Entity location precondition is stale.");
              }
              await ensureNoContainmentCycle(sql, input, entityId, locationId);
              const updated = await sql<{ version: string }[]>`
                UPDATE game.entity_instances
                SET location_id = ${locationId}, version = version + 1, updated_at = now()
                WHERE world_id = ${input.scope.worldId}
                  AND shard_id = ${input.scope.shardId}
                  AND instance_id = ${entityId}
                  ${operation.expectedVersion === undefined
                    ? sql``
                    : sql`AND version = ${operation.expectedVersion}`}
                RETURNING version::text
              `;
              if (!updated[0]) {
                throw new UniversalOperationError("stale_entity", "Entity changed before movement.");
              }
              result = {
                order,
                type: operation.type,
                entityId,
                previousLocationId: row.location_id,
                locationId,
                version: Number(updated[0].version),
              };
              break;
            }
            case "transfer_ownership":
            case "set_controller": {
              const entityId = resolveEntityRef(operation.entityRef, symbols);
              const row = await requireEntity(sql, input, entityId, entityCache);
              requireExpectedVersion(row, operation.expectedVersion);
              const reference =
                operation.type === "transfer_ownership"
                  ? operation.ownerRef
                  : operation.controllerRef;
              const targetId = resolveNullableEntityRef(reference, symbols);
              if (targetId) await requireEntity(sql, input, targetId, entityCache);
              const updated =
                operation.type === "transfer_ownership"
                  ? await sql<{ version: string }[]>`
                      UPDATE game.entity_instances
                      SET owner_id = ${targetId}, version = version + 1, updated_at = now()
                      WHERE world_id = ${input.scope.worldId}
                        AND shard_id = ${input.scope.shardId}
                        AND instance_id = ${entityId}
                        ${operation.expectedVersion === undefined
                          ? sql``
                          : sql`AND version = ${operation.expectedVersion}`}
                      RETURNING version::text
                    `
                  : await sql<{ version: string }[]>`
                      UPDATE game.entity_instances
                      SET controller_id = ${targetId}, version = version + 1, updated_at = now()
                      WHERE world_id = ${input.scope.worldId}
                        AND shard_id = ${input.scope.shardId}
                        AND instance_id = ${entityId}
                        ${operation.expectedVersion === undefined
                          ? sql``
                          : sql`AND version = ${operation.expectedVersion}`}
                      RETURNING version::text
                    `;
              if (!updated[0]) {
                throw new UniversalOperationError("stale_entity", "Entity changed before transfer.");
              }
              result = {
                order,
                type: operation.type,
                entityId,
                targetId,
                version: Number(updated[0].version),
              };
              break;
            }
            case "transfer_possession": {
              const entityId = resolveEntityRef(operation.entityRef, symbols);
              const row = await requireEntity(sql, input, entityId, entityCache);
              requireExpectedVersion(row, operation.expectedVersion);
              const possessorId = resolveNullableEntityRef(operation.possessorRef, symbols);
              if (possessorId) await requireEntity(sql, input, possessorId, entityCache);
              await sql`
                DELETE FROM game.entity_relations
                WHERE world_id = ${input.scope.worldId}
                  AND source_instance_id = ${entityId}
                  AND relation_type = 'possessed_by'
              `;
              if (possessorId) {
                await sql`
                  INSERT INTO game.entity_relations (
                    world_id, source_instance_id, target_instance_id,
                    relation_type, parameters
                  ) VALUES (
                    ${input.scope.worldId}, ${entityId}, ${possessorId},
                    'possessed_by', ${json({ visibility: "player_known", sourceEventId: eventId })}::jsonb
                  )
                `;
              }
              const updated = await sql<{ version: string }[]>`
                UPDATE game.entity_instances
                SET version = version + 1, updated_at = now()
                WHERE world_id = ${input.scope.worldId}
                  AND shard_id = ${input.scope.shardId}
                  AND instance_id = ${entityId}
                  ${operation.expectedVersion === undefined
                    ? sql``
                    : sql`AND version = ${operation.expectedVersion}`}
                RETURNING version::text
              `;
              if (!updated[0]) {
                throw new UniversalOperationError("stale_entity", "Entity changed before possession transfer.");
              }
              result = {
                order,
                type: operation.type,
                entityId,
                possessorId,
                version: Number(updated[0].version),
              };
              break;
            }
            case "set_relation": {
              const sourceId = resolveEntityRef(operation.sourceRef, symbols);
              const targetId = resolveEntityRef(operation.targetRef, symbols);
              await requireEntity(sql, input, sourceId, entityCache);
              await requireEntity(sql, input, targetId, entityCache);
              if (sourceId === targetId && controlledRelationTypes.has(operation.relationType)) {
                throw new UniversalOperationError(
                  "invalid_operation",
                  "Entity cannot hold this relation to itself.",
                );
              }
              const relationRows = await sql<{ relation_id: string }[]>`
                INSERT INTO game.entity_relations (
                  world_id, source_instance_id, target_instance_id,
                  relation_type, parameters
                ) VALUES (
                  ${input.scope.worldId}, ${sourceId}, ${targetId},
                  ${operation.relationType}, ${json(operation.parameters)}::jsonb
                )
                ON CONFLICT (source_instance_id, target_instance_id, relation_type)
                DO UPDATE SET parameters = EXCLUDED.parameters
                RETURNING relation_id
              `;
              result = {
                order,
                type: operation.type,
                relationId: relationRows[0]!.relation_id,
                sourceId,
                targetId,
                relationType: operation.relationType,
              };
              break;
            }
            case "remove_relation": {
              const sourceId = resolveEntityRef(operation.sourceRef, symbols);
              const targetId = resolveEntityRef(operation.targetRef, symbols);
              const removed = await sql<{ relation_id: string }[]>`
                DELETE FROM game.entity_relations
                WHERE world_id = ${input.scope.worldId}
                  AND source_instance_id = ${sourceId}
                  AND target_instance_id = ${targetId}
                  AND relation_type = ${operation.relationType}
                RETURNING relation_id
              `;
              result = {
                order,
                type: operation.type,
                sourceId,
                targetId,
                relationType: operation.relationType,
                removed: removed.length > 0,
              };
              break;
            }
            case "set_access": {
              const subjectId = resolveEntityRef(operation.subjectRef, symbols);
              const resourceId = resolveEntityRef(operation.resourceRef, symbols);
              await requireEntity(sql, input, subjectId, entityCache);
              await requireEntity(sql, input, resourceId, entityCache);
              if (operation.access === "grant") {
                await sql`
                  INSERT INTO game.entity_relations (
                    world_id, source_instance_id, target_instance_id,
                    relation_type, parameters
                  ) VALUES (
                    ${input.scope.worldId}, ${subjectId}, ${resourceId},
                    'has_access_to', ${json(operation.parameters)}::jsonb
                  )
                  ON CONFLICT (source_instance_id, target_instance_id, relation_type)
                  DO UPDATE SET parameters = EXCLUDED.parameters
                `;
              } else {
                await sql`
                  DELETE FROM game.entity_relations
                  WHERE world_id = ${input.scope.worldId}
                    AND source_instance_id = ${subjectId}
                    AND target_instance_id = ${resourceId}
                    AND relation_type = 'has_access_to'
                `;
              }
              result = {
                order,
                type: operation.type,
                subjectId,
                resourceId,
                access: operation.access,
              };
              break;
            }
            case "set_condition": {
              const entityId = resolveEntityRef(operation.entityRef, symbols);
              const row = await requireEntity(sql, input, entityId, entityCache);
              requireExpectedVersion(row, operation.expectedVersion);
              const path = ["conditions", operation.condition];
              const conditionValue = {
                active: operation.active,
                intensity: operation.intensity ?? 100,
                ...(operation.durationSeconds
                  ? {
                      resolvesAt: new Date(Date.now() + operation.durationSeconds * 1_000).toISOString(),
                    }
                  : {}),
                metadata: operation.metadata,
                sourceEventId: eventId,
              };
              const updated = operation.active
                ? await sql<{ version: string }[]>`
                    UPDATE game.entity_instances
                    SET state = jsonb_set(state, ${path}::text[], ${json(conditionValue)}::jsonb, true),
                        version = version + 1,
                        updated_at = now()
                    WHERE world_id = ${input.scope.worldId}
                      AND shard_id = ${input.scope.shardId}
                      AND instance_id = ${entityId}
                      ${operation.expectedVersion === undefined
                        ? sql``
                        : sql`AND version = ${operation.expectedVersion}`}
                    RETURNING version::text
                  `
                : await sql<{ version: string }[]>`
                    UPDATE game.entity_instances
                    SET state = state #- ${path}::text[],
                        version = version + 1,
                        updated_at = now()
                    WHERE world_id = ${input.scope.worldId}
                      AND shard_id = ${input.scope.shardId}
                      AND instance_id = ${entityId}
                      ${operation.expectedVersion === undefined
                        ? sql``
                        : sql`AND version = ${operation.expectedVersion}`}
                    RETURNING version::text
                  `;
              if (!updated[0]) {
                throw new UniversalOperationError("stale_entity", "Entity changed before condition update.");
              }
              result = {
                order,
                type: operation.type,
                entityId,
                condition: operation.condition,
                active: operation.active,
                version: Number(updated[0].version),
              };
              break;
            }
            case "adjust_condition": {
              const entityId = resolveEntityRef(operation.entityRef, symbols);
              const row = await requireEntity(sql, input, entityId, entityCache);
              requireExpectedVersion(row, operation.expectedVersion);
              const updated = await sql<{ condition: number; version: string }[]>`
                UPDATE game.entity_instances
                SET condition = GREATEST(0, LEAST(100, condition + ${operation.delta})),
                    version = version + 1,
                    updated_at = now()
                WHERE world_id = ${input.scope.worldId}
                  AND shard_id = ${input.scope.shardId}
                  AND instance_id = ${entityId}
                  ${operation.expectedVersion === undefined
                    ? sql``
                    : sql`AND version = ${operation.expectedVersion}`}
                RETURNING condition, version::text
              `;
              if (!updated[0]) {
                throw new UniversalOperationError("stale_entity", "Entity changed before condition adjustment.");
              }
              result = {
                order,
                type: operation.type,
                entityId,
                previousCondition: row.condition,
                condition: updated[0].condition,
                version: Number(updated[0].version),
              };
              break;
            }
            case "adjust_resource": {
              const entityId = resolveEntityRef(operation.entityRef, symbols);
              const row = await requireEntity(sql, input, entityId, entityCache);
              requireExpectedVersion(row, operation.expectedVersion);
              if (
                operation.minimum !== undefined &&
                operation.maximum !== undefined &&
                operation.minimum > operation.maximum
              ) {
                throw new UniversalOperationError(
                  "invalid_operation",
                  "Resource minimum cannot exceed maximum.",
                );
              }
              const path = ["resources", operation.resource];
              const updated = await sql<{ value: string; version: string }[]>`
                WITH current_value AS (
                  SELECT COALESCE((state #>> ${path}::text[])::numeric, 0) AS value
                  FROM game.entity_instances
                  WHERE world_id = ${input.scope.worldId}
                    AND shard_id = ${input.scope.shardId}
                    AND instance_id = ${entityId}
                    ${operation.expectedVersion === undefined
                      ? sql``
                      : sql`AND version = ${operation.expectedVersion}`}
                  FOR UPDATE
                ), bounded AS (
                  SELECT LEAST(
                    ${operation.maximum ?? 1_000_000_000}::numeric,
                    GREATEST(
                      ${operation.minimum ?? -1_000_000_000}::numeric,
                      value + ${operation.delta}::numeric
                    )
                  ) AS value
                  FROM current_value
                )
                UPDATE game.entity_instances entity
                SET state = jsonb_set(entity.state, ${path}::text[], to_jsonb(bounded.value), true),
                    version = entity.version + 1,
                    updated_at = now()
                FROM bounded
                WHERE entity.world_id = ${input.scope.worldId}
                  AND entity.shard_id = ${input.scope.shardId}
                  AND entity.instance_id = ${entityId}
                RETURNING bounded.value::text AS value, entity.version::text
              `;
              if (!updated[0]) {
                throw new UniversalOperationError("stale_entity", "Entity changed before resource adjustment.");
              }
              result = {
                order,
                type: operation.type,
                entityId,
                resource: operation.resource,
                delta: operation.delta,
                value: Number(updated[0].value),
                version: Number(updated[0].version),
              };
              break;
            }
            case "set_state_value":
            case "remove_state_value": {
              const entityId = resolveEntityRef(operation.entityRef, symbols);
              const row = await requireEntity(sql, input, entityId, entityCache);
              requireExpectedVersion(row, operation.expectedVersion);
              const updated =
                operation.type === "set_state_value"
                  ? await sql<{ version: string }[]>`
                      UPDATE game.entity_instances
                      SET state = jsonb_set(state, ${operation.path}::text[], ${json(operation.value)}::jsonb, true),
                          version = version + 1,
                          updated_at = now()
                      WHERE world_id = ${input.scope.worldId}
                        AND shard_id = ${input.scope.shardId}
                        AND instance_id = ${entityId}
                        ${operation.expectedVersion === undefined
                          ? sql``
                          : sql`AND version = ${operation.expectedVersion}`}
                      RETURNING version::text
                    `
                  : await sql<{ version: string }[]>`
                      UPDATE game.entity_instances
                      SET state = state #- ${operation.path}::text[],
                          version = version + 1,
                          updated_at = now()
                      WHERE world_id = ${input.scope.worldId}
                        AND shard_id = ${input.scope.shardId}
                        AND instance_id = ${entityId}
                        ${operation.expectedVersion === undefined
                          ? sql``
                          : sql`AND version = ${operation.expectedVersion}`}
                      RETURNING version::text
                    `;
              if (!updated[0]) {
                throw new UniversalOperationError("stale_entity", "Entity changed before state update.");
              }
              result = {
                order,
                type: operation.type,
                entityId,
                path: operation.path,
                version: Number(updated[0].version),
              };
              break;
            }
            case "create_information_asset": {
              const holderId = resolveEntityRef(operation.holderRef, symbols);
              const subjectId = resolveNullableEntityRef(operation.subjectRef, symbols);
              await requireEntity(sql, input, holderId, entityCache);
              if (subjectId) await requireEntity(sql, input, subjectId, entityCache);
              const informationId = randomUUID();
              await sql`
                INSERT INTO game.information_assets (
                  information_id, world_id, holder_instance_id, subject_instance_id,
                  content, confidence, truth_status, source_event_id
                ) VALUES (
                  ${informationId}, ${input.scope.worldId}, ${holderId}, ${subjectId},
                  ${operation.content}, ${operation.confidenceBasisPoints / 10_000},
                  ${operation.truthStatus}, ${eventId}
                )
              `;
              result = {
                order,
                type: operation.type,
                informationId,
                holderId,
                subjectId,
              };
              break;
            }
            case "invalidate_information_asset": {
              const updated = await sql<{ information_id: string }[]>`
                UPDATE game.information_assets
                SET valid_until = now(),
                    invalidated_by_event_id = ${eventId},
                    invalidation_reason = ${operation.reason}
                WHERE world_id = ${input.scope.worldId}
                  AND information_id = ${operation.informationId}
                  AND valid_until IS NULL
                RETURNING information_id
              `;
              if (!updated[0]) {
                throw new UniversalOperationError(
                  "invalid_operation",
                  "Active information asset not found.",
                );
              }
              result = {
                order,
                type: operation.type,
                informationId: updated[0].information_id,
              };
              break;
            }
            case "schedule_timed_work": {
              const subjectEntityIds = operation.subjectRefs.map((reference) =>
                resolveEntityRef(reference, symbols),
              );
              for (const entityId of subjectEntityIds) {
                await requireEntity(sql, input, entityId, entityCache);
              }
              const scheduleId = randomUUID();
              const resolvesAt = new Date(Date.now() + operation.durationSeconds * 1_000);
              const payload = {
                ...operation.payload,
                description: operation.description,
                actorId: input.actorId || null,
                sourcePlanId: input.sourcePlanId || null,
                sourceStepId: input.sourceStepId || null,
              };
              await sql`
                INSERT INTO game.scheduled_actions (
                  schedule_id, intent_id, world_id, shard_id, resolves_at, status,
                  kind, payload, source_event_id, subject_entity_ids,
                  expected_versions, resolution_policy
                ) VALUES (
                  ${scheduleId}, ${input.sourceIntentId || null}, ${input.scope.worldId},
                  ${input.scope.shardId}, ${resolvesAt.toISOString()}, 'pending',
                  ${operation.kind}, ${json(payload)}::jsonb, ${eventId},
                  ${json(subjectEntityIds)}::jsonb,
                  ${json(operation.expectedVersions)}::jsonb,
                  'authoritative-v1'
                )
              `;
              if (operation.symbol) symbols.schedules.set(operation.symbol, scheduleId);
              result = {
                order,
                type: operation.type,
                scheduleId,
                kind: operation.kind,
                subjectEntityIds,
                resolvesAt: resolvesAt.toISOString(),
                ...(operation.symbol ? { symbol: operation.symbol } : {}),
              };
              break;
            }
            case "cancel_timed_work": {
              const updated = await sql<{ schedule_id: string }[]>`
                UPDATE game.scheduled_actions
                SET status = 'cancelled',
                    cancelled_event_id = ${eventId},
                    cancellation_reason = ${operation.reason}
                WHERE world_id = ${input.scope.worldId}
                  AND shard_id = ${input.scope.shardId}
                  AND schedule_id = ${operation.scheduleId}
                  AND status IN ('pending', 'resolving')
                RETURNING schedule_id
              `;
              if (!updated[0]) {
                throw new UniversalOperationError(
                  "invalid_operation",
                  "Pending scheduled work not found.",
                );
              }
              result = {
                order,
                type: operation.type,
                scheduleId: updated[0].schedule_id,
              };
              break;
            }
            case "apply_area_effect": {
              const areaId = resolveEntityRef(operation.areaRef, symbols);
              await requireEntity(sql, input, areaId, entityCache);
              const areaEffectId = randomUUID();
              const resolvesAt = operation.durationSeconds
                ? new Date(Date.now() + operation.durationSeconds * 1_000).toISOString()
                : null;
              await sql`
                INSERT INTO game.area_effects (
                  area_effect_id, world_id, shard_id, area_instance_id,
                  effect, intensity, metadata, source_event_id, resolves_at
                ) VALUES (
                  ${areaEffectId}, ${input.scope.worldId}, ${input.scope.shardId},
                  ${areaId}, ${operation.effect}, ${operation.intensity},
                  ${json(operation.metadata)}::jsonb, ${eventId}, ${resolvesAt}
                )
              `;
              if (operation.symbol) symbols.areaEffects.set(operation.symbol, areaEffectId);
              result = {
                order,
                type: operation.type,
                areaEffectId,
                areaId,
                effect: operation.effect,
                resolvesAt,
                ...(operation.symbol ? { symbol: operation.symbol } : {}),
              };
              break;
            }
            case "remove_area_effect": {
              const updated = await sql<{ area_effect_id: string }[]>`
                UPDATE game.area_effects
                SET removed_at = now(),
                    removed_by_event_id = ${eventId},
                    removal_reason = ${operation.reason}
                WHERE world_id = ${input.scope.worldId}
                  AND shard_id = ${input.scope.shardId}
                  AND area_effect_id = ${operation.areaEffectId}
                  AND removed_at IS NULL
                RETURNING area_effect_id
              `;
              if (!updated[0]) {
                throw new UniversalOperationError("invalid_operation", "Active area effect not found.");
              }
              result = {
                order,
                type: operation.type,
                areaEffectId: updated[0].area_effect_id,
              };
              break;
            }
            default: {
              const exhaustive: never = operation;
              throw new UniversalOperationError(
                "invalid_operation",
                `Unsupported operation: ${(exhaustive as { type?: string }).type || "unknown"}.`,
              );
            }
          }
          operationResults.push(result);
        }

        const symbolMap = publicSymbolMap(symbols);
        const playerVisibleFacts = (input.playerVisibleFacts || []).slice(0, 64);
        const hiddenFacts = (input.hiddenFacts || []).slice(0, 64);
        const eventPayload = {
          status: "committed",
          receiptId,
          requestHash,
          authority: input.authority,
          sourcePlanId: input.sourcePlanId || null,
          sourceStepId: input.sourceStepId || null,
          symbolMap,
          operationResults,
          playerVisibleFacts,
          hiddenFacts,
        };
        await sql`
          UPDATE game.event_ledger
          SET involved_entity_ids = ${json([...involvedEntityIds])}::jsonb,
              payload = ${json(eventPayload)}::jsonb
          WHERE event_id = ${eventId}
        `;
        await sql`
          INSERT INTO game.mutation_receipts (
            receipt_id, world_id, shard_id, idempotency_key, request_hash,
            authority, actor_id, event_id, symbol_map, player_visible_facts,
            hidden_facts, request_payload
          ) VALUES (
            ${receiptId}, ${input.scope.worldId}, ${input.scope.shardId},
            ${input.idempotencyKey}, ${requestHash}, ${input.authority},
            ${input.actorId || null}, ${eventId}, ${json(symbolMap)}::jsonb,
            ${json(playerVisibleFacts)}::jsonb, ${json(hiddenFacts)}::jsonb,
            ${json(requestPayload)}::jsonb
          )
        `;
        for (const [index, result] of operationResults.entries()) {
          await sql`
            INSERT INTO game.mutation_operation_results (
              receipt_id, operation_order, operation_type, result
            ) VALUES (
              ${receiptId}, ${index + 1}, ${String(result.type)}, ${json(result)}::jsonb
            )
          `;
        }

        return UniversalMutationReceiptSchema.parse({
          receiptId,
          eventId,
          worldId: input.scope.worldId,
          shardId: input.scope.shardId,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          authority: input.authority,
          actorId: input.actorId,
          symbolMap,
          operationResults,
          playerVisibleFacts,
          hiddenFacts,
          createdAt,
          idempotentReplay: false,
        });
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "40001"
      ) {
        throw new UniversalOperationError(
          "stale_entity",
          "World state changed while the mutation was being committed.",
        );
      }
      throw error;
    }
  }

  return { execute, findReplay };
}

export type UniversalOperationExecutor = ReturnType<typeof createUniversalOperationExecutor>;
