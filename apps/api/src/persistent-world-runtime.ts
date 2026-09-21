import type { FastifyInstance, FastifyRequest } from "fastify";
import type { MaterializationAnalysisRequest, WorldActionKind } from "@nocturne/contracts";
import type { AiDecisionClient, AiProviderClient } from "@nocturne/ai-gm";
import {
  createMaterializationStore,
  createNarrativeMemoryStore,
  createNonMutatingEventStore,
  createOperatorDashboardStore,
  createPersistentPlanStore,
  createPersistentSceneStore,
  createPlayerDashboardStore,
  createPlayerEffectStore,
  createReferenceResolutionStore,
  createRelevanceContextStore,
  createUniversalOperationExecutor,
  createWorldActionRequestStore,
  createWorldActionStepStore,
  createWorldInspectorStore,
  type WorldScope,
  type createDatabase,
} from "@nocturne/database";
import { createCommittedEventNarrator } from "./committed-event-narrator.js";
import { createGameplayTelemetryWriter } from "./gameplay-telemetry.js";
import {
  instrumentAiClient,
  instrumentAiDecisionClient,
  instrumentContextStore,
  instrumentPlanStore,
  instrumentReferenceStore,
  instrumentStepStore,
} from "./persistent-world-instrumentation.js";
import { registerOperatorDashboardRoutes } from "./operator-dashboard-routes.js";
import { registerPlayerDashboardRoutes } from "./player-dashboard-routes.js";
import { registerPlayerEffectRoutes } from "./player-effect-routes.js";
import { createPersistentWorldActionService } from "./persistent-world-action-service.js";
import { registerPersistentWorldRoutes } from "./persistent-world-routes.js";
import { createRoutineActionService } from "./routine-action-service.js";
import { createSearchDiscoveryService } from "./search-discovery-service.js";
import { createSemanticActionExecutionService } from "./semantic-action-execution-service.js";
import { createTimedSemanticActionService } from "./timed-semantic-action-service.js";
import { createWorldActionHandlerRegistry } from "./world-action-handler-registry.js";

export async function registerPersistentWorldRuntime(
  app: FastifyInstance,
  dependencies: {
    database: ReturnType<typeof createDatabase>;
    client: Pick<AiProviderClient, "generateStructured" | "generateText">;
    decisionClient: Pick<AiDecisionClient, "decide">;
    rollSecret: string | Buffer;
    resolveScope(request: FastifyRequest): Promise<WorldScope>;
    /** Compatibility input retained while narrative history moves into the database projection. */
    listRecentPlayerSafeText?(input: { scope: WorldScope; limit: number }): Promise<string[]>;
    loadReusableDefinitions(input: {
      scope: Pick<WorldScope, "worldId">;
      requestedConcept: string;
    }): Promise<MaterializationAnalysisRequest["reusableDefinitions"]>;
    loadArea(input: {
      scope: Pick<WorldScope, "worldId" | "shardId">;
      areaId: string;
    }): Promise<{ name: string; description: string } | null>;
    scheduleMove(input: {
      scope: WorldScope;
      requestId: string;
      planId: string;
      stepId: string;
      actorId: string;
      destinationId: string;
      expectedVersions: Record<string, number>;
      idempotencyKey: string;
    }): Promise<{ scheduleId: string; narration: string }>;
    executeExistingAction(input: {
      kind: Exclude<WorldActionKind, "search" | "move">;
      scope: WorldScope;
      actorId: string;
      rawText: string;
      idempotencyKey: string;
      payload: Record<string, unknown>;
    }): Promise<
      | {
          state: "completed";
          outcomeGrade: string;
          eventId: string;
          receiptId?: string;
          narration: string;
        }
      | {
          state: "waiting";
          planStatus: "waiting_for_time" | "waiting_for_world_event";
          reason: string;
          narration: string;
          scheduleId?: string;
        }
    >;
    simulateReferencedEntity?(input: {
      scope: WorldScope;
      entityId: string;
      relevantFacts: string[];
    }): Promise<void>;
  },
) {
  const executor = createUniversalOperationExecutor(dependencies.database);
  const nonMutatingEvents = createNonMutatingEventStore(dependencies.database);
  const routineActions = createRoutineActionService(nonMutatingEvents);
  const semanticActions = createSemanticActionExecutionService({
    executor,
    nonMutatingEvents,
    rollSecret: dependencies.rollSecret,
  });
  const timedActions = createTimedSemanticActionService(executor);
  const telemetry = createGameplayTelemetryWriter(app.log);
  const client = instrumentAiClient(dependencies.client, telemetry);
  const decisionClient = instrumentAiDecisionClient(dependencies.decisionClient, telemetry);
  const context = instrumentContextStore(
    createRelevanceContextStore(dependencies.database),
    telemetry,
  );
  const references = instrumentReferenceStore(
    createReferenceResolutionStore(dependencies.database),
    telemetry,
  );
  const plans = instrumentPlanStore(createPersistentPlanStore(dependencies.database), telemetry);
  const requests = createWorldActionRequestStore(dependencies.database);
  const steps = instrumentStepStore(createWorldActionStepStore(dependencies.database), telemetry);
  const materialization = createMaterializationStore(dependencies.database, executor);
  const narrativeMemory = createNarrativeMemoryStore(dependencies.database);
  const narrateCommittedEvents = createCommittedEventNarrator({
    client,
    readEvidence: async ({ scope, actorId, eventIds }) => {
      const rows = await dependencies.database.client<
        {
          event_id: string;
          event_type: string;
          world_id: string;
          shard_id: string;
          actor_id: string;
          player_visible_facts: unknown;
        }[]
      >`
        SELECT receipt.event_id, event.event_type,
               receipt.world_id, receipt.shard_id, receipt.actor_id,
               receipt.player_visible_facts
        FROM game.mutation_receipts receipt
        JOIN game.event_ledger event
          ON event.event_id = receipt.event_id
         AND event.world_id = receipt.world_id
         AND event.shard_id = receipt.shard_id
        WHERE receipt.event_id = ANY(${dependencies.database.client.array(eventIds, 2950)})
          AND receipt.world_id = ${scope.worldId}
          AND receipt.shard_id = ${scope.shardId}
          AND receipt.actor_id = ${actorId}
        ORDER BY event.world_time, event.event_id
      `;
      return rows.map((row) => ({
        eventId: row.event_id,
        eventType: row.event_type,
        worldId: row.world_id,
        shardId: row.shard_id,
        actorId: row.actor_id,
        playerVisibleFacts: Array.isArray(row.player_visible_facts)
          ? row.player_visible_facts.filter(
              (fact): fact is string => typeof fact === "string" && Boolean(fact.trim()),
            )
          : [],
      }));
    },
    onFailure: (error, eventIds) => {
      app.log.error(
        {
          errorCode: error instanceof Error ? error.name : "narration_failed",
          eventCount: eventIds.length,
        },
        "committed_event_narration_unavailable",
      );
    },
  });
  const search = createSearchDiscoveryService({
    client,
    decisionClient,
    context,
    materialization,
    executor,
    rollSecret: dependencies.rollSecret,
    loadReusableDefinitions: dependencies.loadReusableDefinitions,
    loadArea: dependencies.loadArea,
  });
  const handlers = createWorldActionHandlerRegistry({
    telemetry,
    search,
    scheduleMove: dependencies.scheduleMove,
    scheduleTimedAction: timedActions.schedule,
    executeRoutineAction: routineActions.execute,
    executeSemanticAction: semanticActions.execute,
    executeExistingAction: dependencies.executeExistingAction,
  });
  const actions = createPersistentWorldActionService({
    decisionClient,
    requests,
    context,
    references,
    plans,
    steps,
    handlers,
    compileNarrativeContext: narrativeMemory.compile,
    narrateCommittedEvents,
    recordCompletedTurn: narrativeMemory.recordCompletedTurn,
    simulateReferencedEntity: dependencies.simulateReferencedEntity,
  });
  const scene = createPersistentSceneStore(dependencies.database);
  const effects = createPlayerEffectStore(dependencies.database);
  const dashboard = createPlayerDashboardStore(dependencies.database, { scene, effects });
  const operatorDashboard = createOperatorDashboardStore(dependencies.database);
  const inspector = createWorldInspectorStore(dependencies.database, executor, plans);

  await registerPersistentWorldRoutes(app, {
    actions,
    scene,
    inspector,
    resolveScope: dependencies.resolveScope,
    telemetry,
    isRuntimeEnabled: async ({ worldId }) => {
      const rows = await dependencies.database.client<{ enabled: boolean }[]>`
        SELECT enabled
        FROM game.runtime_features
        WHERE world_id = ${worldId}
          AND feature_key = 'persistent_world_runtime'
      `;
      return rows[0]?.enabled === true;
    },
  });
  await registerPlayerEffectRoutes(app, {
    effects,
    resolveScope: dependencies.resolveScope,
  });
  await registerPlayerDashboardRoutes(app, {
    dashboard,
    resolveScope: dependencies.resolveScope,
  });
  await registerOperatorDashboardRoutes(app, {
    dashboard: operatorDashboard,
    resolveScope: dependencies.resolveScope,
  });
}
