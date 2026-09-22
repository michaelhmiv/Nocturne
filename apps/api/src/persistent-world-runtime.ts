import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  WorldActionPlayerSafeResultSchema,
  type MaterializationAnalysisRequest,
  type RelevanceCompiledContext,
  type SemanticActionFrame,
  type WorldActionKind,
  type WorldActionPlayerSafeResult,
} from "@nocturne/contracts";
import type { AiDecisionClient, AiProviderClient } from "@nocturne/ai-gm";
import { OSM_STARTER_POINT } from "@nocturne/rules-engine";
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
import { createCityAwareWorldActionService } from "./city-aware-action-service.js";
import { resolveCityDestinationFromFeatures } from "./resolve-city-destination.js";
import { registerPersistentWorldRoutes } from "./persistent-world-routes.js";
import { createRoutineActionService } from "./routine-action-service.js";
import { createSearchDiscoveryService } from "./search-discovery-service.js";
import { createSemanticActionExecutionService } from "./semantic-action-execution-service.js";
import { createTimedSemanticActionService } from "./timed-semantic-action-service.js";
import { createWorldActionHandlerRegistry } from "./world-action-handler-registry.js";
