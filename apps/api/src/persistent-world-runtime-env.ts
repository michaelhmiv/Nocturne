import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createAiProviderClientFromEnv, resolveAiProviderConfigFromEnv } from "@nocturne/ai-gm";
import { getSessionFromNodeHeaders } from "@nocturne/auth";
import type { MaterializationAnalysisRequest, WorldActionKind } from "@nocturne/contracts";
import {
  DEFAULT_SHARD_ID,
  DEFAULT_WORLD_ID,
  PersistentWorldError,
  createActionStore,
  createAgentStore,
  createConsumptionStore,
  createDatabase,
  createLocationStore,
  createUniversalOperationExecutor,
  createWorldStore,
  type WorldScope,
} from "@nocturne/database";
import { createActionService } from "./action-service.js";
import { createEphemeralConsumptionService } from "./ephemeral-consumption-service.js";
import { registerPersistentWorldRuntime } from "./persistent-world-runtime.js";

const deterministicKey = (value: string) =>
  createHash("sha256").update(value).digest("hex").slice(0, 24);

const playerText = (result: Record<string, unknown> | null) => {
  if (!result) return null;
  if (typeof result.narration === "string") return result.narration;
  if (typeof result.prompt === "string") return result.prompt;
  return null;
};

export async function registerPersistentWorldRuntimeFromEnv(app: FastifyInstance) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for persistent-world routes.");
  const rollSecret =
    process.env.NOCTURNE_ROLL_SECRET ||
    process.env.NOCTURNE_RESOLUTION_SECRET ||
    process.env.BETTER_AUTH_SECRET;
  if (!rollSecret) {
    throw new Error(
      "NOCTURNE_ROLL_SECRET, NOCTURNE_RESOLUTION_SECRET, or BETTER_AUTH_SECRET is required.",
    );
  }

  const database = createDatabase(databaseUrl);
  const client = createAiProviderClientFromEnv(process.env);
  const providerConfiguration = resolveAiProviderConfigFromEnv(process.env);
  const agents = createAgentStore(database);
  const worlds = createWorldStore(database);
  const locations = createLocationStore(database);
  const legacyActions = createActionService(
    createActionStore(database),
    process.env,
    locations,
    createConsumptionStore(database),
  );
  const executor = createUniversalOperationExecutor(database);

  async function requireUser(request: FastifyRequest) {
    const authorization = request.headers.authorization;
    const bearer = Array.isArray(authorization) ? authorization[0] : authorization;
    const agent = await agents.authenticate(bearer);
    if (agent) return { id: agent.userId };
    if (
      process.env.NOCTURNE_GUEST_MODE === "true" &&
      request.headers["x-nocturne-guest-mode"] === "1"
    ) {
      return { id: process.env.NOCTURNE_GUEST_USER_ID || "nocturne-test-guest" };
    }
    const session = await getSessionFromNodeHeaders(request.headers);
    if (!session) throw new PersistentWorldError("forbidden", "Authentication is required.");
    return session.user;
  }

  async function resolveScope(request: FastifyRequest): Promise<WorldScope> {
    const user = await requireUser(request);
    await worlds.ensureMembership({ userId: user.id, worldId: DEFAULT_WORLD_ID });
    let scope = await worlds.resolveForUser({
      userId: user.id,
      worldId: DEFAULT_WORLD_ID,
      shardId: DEFAULT_SHARD_ID,
    });
    const characters = await database.client<{ character_instance_id: string }[]>`
      SELECT character.character_instance_id
      FROM game.player_characters character
      JOIN game.entity_instances instance
        ON instance.instance_id = character.character_instance_id
       AND instance.world_id = character.world_id
      WHERE character.world_id = ${scope.worldId}
        AND character.user_id = ${scope.userId}
        AND instance.shard_id = ${scope.shardId}
      ORDER BY character.selected DESC, character.created_at
      LIMIT 1
    `;
    const selectedCharacterId = characters[0]?.character_instance_id || null;
    if (selectedCharacterId && selectedCharacterId !== scope.selectedCharacterId) {
      await worlds.setSelectedCharacter({ scope, characterId: selectedCharacterId });
      scope = await worlds.resolveForUser({
        userId: user.id,
        worldId: DEFAULT_WORLD_ID,
        shardId: DEFAULT_SHARD_ID,
      });
    }
    return scope;
  }

  const listRecentPlayerSafeText = async ({
    scope,
    limit,
  }: {
    scope: WorldScope;
    limit: number;
  }) => {
    const boundedLimit = Math.max(1, Math.min(limit, 20));
    const rows = await database.client<
      { command: string; player_safe_result: Record<string, unknown> | null }[]
    >`
      SELECT command, player_safe_result
      FROM game.world_action_requests
      WHERE world_id = ${scope.worldId}
        AND shard_id = ${scope.shardId}
        AND user_id = ${scope.userId}
      ORDER BY created_at DESC
      LIMIT ${boundedLimit}
    `;
    return rows
      .flatMap((row) => [row.command, playerText(row.player_safe_result)])
      .filter((value): value is string => Boolean(value))
      .slice(0, boundedLimit);
  };

  const ephemeralConsumption = createEphemeralConsumptionService({
    database,
    client,
    rollSecret,
    listRecentPlayerSafeText,
  });

  const runtimeRows = await database.client<{ enabled: boolean }[]>`
    SELECT enabled
    FROM game.runtime_features
    WHERE world_id = ${DEFAULT_WORLD_ID}
      AND feature_key = 'persistent_world_runtime'
  `;
  const runtimeEnabled = runtimeRows[0]?.enabled === true;

  if (runtimeEnabled) {
    app.addHook("preHandler", async (request, reply) => {
      const path = request.url.split("?", 1)[0];
      if (request.method === "POST" && (path === "/v1/ai-jobs/actions" || path === "/v1/actions")) {
        return reply.code(410).send({
          error: "legacy_action_route_disabled",
          message:
            "This action endpoint was replaced by /v1/persistent-world/actions. Refresh the client and retry through the persistent-world runtime.",
        });
      }
    });
  }

  app.get("/v1/system/ai-provider", async () => ({
    provider: providerConfiguration.provider,
    baseUrl: providerConfiguration.baseUrl,
    model: providerConfiguration.model,
    authoritativeModel: providerConfiguration.authoritativeModel,
    creativeModel: providerConfiguration.creativeModel,
    thinkingMode: providerConfiguration.thinkingMode,
    jsonMode: providerConfiguration.jsonMode,
    maxTokens: providerConfiguration.maxTokens,
    configured: Boolean(providerConfiguration.apiKey),
  }));

  await registerPersistentWorldRuntime(app, {
    database,
    client,
    rollSecret,
    resolveScope,
    listRecentPlayerSafeText,
    loadReusableDefinitions: async ({ scope, requestedConcept }) => {
      const exactPattern = `%${requestedConcept.trim()}%`;
      const rows = await database.client<
        {
          definition_id: string;
          definition_type: string;
          name: string;
          concept_summary: string;
          current_payload: Record<string, unknown> | null;
        }[]
      >`
        SELECT definition.definition_id, definition.definition_type,
               definition.name, definition.concept_summary,
               revision.payload AS current_payload
        FROM game.entity_definitions definition
        LEFT JOIN game.definition_revisions revision
          ON revision.revision_id = definition.current_revision_id
        WHERE (definition.world_id = ${scope.worldId} OR definition.world_id IS NULL)
          AND definition.lifecycle_status = 'approved'
        ORDER BY
          (definition.name ILIKE ${exactPattern}) DESC,
          (definition.concept_summary ILIKE ${exactPattern}) DESC,
          definition.updated_at DESC
        LIMIT 24
      `;
      return rows.map((row): MaterializationAnalysisRequest["reusableDefinitions"][number] => ({
        definitionId: row.definition_id,
        definitionType: row.definition_type,
        name: row.name,
        conceptSummary: row.concept_summary,
        currentPayload: row.current_payload || {},
      }));
    },
    loadArea: async ({ scope, areaId }) => {
      const rows = await database.client<{ name: string; description: string }[]>`
        SELECT definition.name,
               COALESCE(definition.concept_summary, definition.name) AS description
        FROM game.entity_instances instance
        JOIN game.entity_definitions definition
          ON definition.definition_id = instance.definition_id
        WHERE instance.world_id = ${scope.worldId}
          AND instance.shard_id = ${scope.shardId}
          AND instance.instance_id = ${areaId}
          AND instance.lifecycle_status NOT IN ('destroyed', 'retired', 'merged')
      `;
      return rows[0] || null;
    },
    scheduleMove: async ({
      scope,
      requestId,
      planId,
      stepId,
      actorId,
      destinationId,
      expectedVersions,
      idempotencyKey,
    }) => {
      const rows = await database.client<
        { location_id: string | null; version: string; destination_exists: boolean }[]
      >`
        SELECT actor.location_id, actor.version::text,
               EXISTS (
                 SELECT 1
                 FROM game.entity_instances destination
                 WHERE destination.world_id = actor.world_id
                   AND destination.shard_id = actor.shard_id
                   AND destination.instance_id = ${destinationId}
                   AND destination.lifecycle_status NOT IN ('destroyed', 'retired', 'merged')
               ) AS destination_exists
        FROM game.entity_instances actor
        WHERE actor.world_id = ${scope.worldId}
          AND actor.shard_id = ${scope.shardId}
          AND actor.instance_id = ${actorId}
      `;
      const actor = rows[0];
      if (!actor) throw new Error("Travel actor is not available in the active world.");
      if (!actor.destination_exists) throw new Error("Travel destination is not available.");
      if (!actor.location_id)
        throw new Error("Travel actor has no authoritative current location.");
      const route = await locations.findShortestPath(actor.location_id, destinationId, 1);
      if (!route) throw new Error("No accessible route exists to the requested destination.");
      const durationSeconds = Math.max(1, Math.round(route.totalTimeSeconds));
      const symbol = "travel_schedule";
      const receipt = await executor.execute({
        scope,
        authority: "player",
        actorId,
        sourcePlanId: planId,
        sourceStepId: stepId,
        idempotencyKey: `${idempotencyKey.slice(0, 180)}:travel:${deterministicKey(requestId)}`,
        declaredFactIds: [],
        branch: {
          operations: [
            {
              type: "schedule_timed_work",
              symbol,
              kind: "travel_arrival",
              subjectRefs: [{ kind: "existing", entityId: actorId }],
              description: `Travel to ${destinationId}`,
              durationSeconds,
              payload: {
                userId: scope.userId,
                actorId,
                locationId: destinationId,
                destinationId,
                expectedLocationId: actor.location_id,
                description: `Travel to ${destinationId}`,
                path: route.path,
              },
              expectedVersions: {
                [actorId]: expectedVersions[actorId] ?? Number(actor.version),
              },
              preconditionFactIds: [],
            },
          ],
        },
        playerVisibleFacts: [`Travel started. ETA ${durationSeconds} seconds.`],
        hiddenFacts: [],
      });
      const scheduleId = receipt.symbolMap[symbol];
      if (!scheduleId) throw new Error("Travel schedule was not created.");
      return {
        scheduleId,
        narration: `Travel started. ETA ${durationSeconds} seconds.`,
      };
    },
    executeExistingAction: async ({
      kind,
      scope,
      actorId,
      rawText,
      idempotencyKey,
      payload,
    }: {
      kind: Exclude<WorldActionKind, "search" | "move">;
      scope: WorldScope;
      actorId: string;
      rawText: string;
      idempotencyKey: string;
      payload: Record<string, unknown>;
    }) => {
      if (kind === "consume" && payload.sourceMode === "ephemeral_environment") {
        const result = await ephemeralConsumption({
          scope,
          actorId,
          rawText,
          idempotencyKey,
          payload,
        });
        app.log.info(
          {
            eventId: result.eventId,
            actorId,
            rawText,
            sourceType: "ephemeral_environment",
            sourceId: null,
            committedOutcomeGrade: result.outcomeGrade,
          },
          "persistent_ephemeral_consumption_resolved",
        );
        return {
          state: "completed" as const,
          outcomeGrade: result.outcomeGrade,
          eventId: result.eventId,
          narration: result.narration,
        };
      }

      const result = await legacyActions.execute(
        scope.userId,
        { actorId, rawText },
        idempotencyKey,
      );
      const unitsConsumed = result.consumption?.unitsConsumed ?? 0;
      const outcomeGrade =
        kind === "consume" && unitsConsumed === 0 ? "no_effect" : result.outcomeGrade;
      if (kind === "consume") {
        app.log.info(
          {
            eventId: result.eventId,
            actorId,
            rawText,
            sourceType: result.consumption?.sourceType || "none",
            sourceId: result.consumption?.sourceId || null,
            unitsConsumed,
            remainingUnits: result.consumption?.remainingUnits ?? null,
            committedOutcomeGrade: result.outcomeGrade,
            playerOutcomeGrade: outcomeGrade,
          },
          "persistent_consumption_resolved",
        );
      }
      return {
        state: "completed" as const,
        outcomeGrade,
        eventId: result.eventId,
        narration: result.narration,
      };
    },
  });

  app.addHook("onClose", async () => database.close());
}
