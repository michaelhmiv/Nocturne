import type { GameplayTelemetryWriter } from "@nocturne/contracts";
import type { AiProviderClient } from "@nocturne/ai-gm";
import type {
  PersistentPlanStore,
  ReferenceResolutionStore,
  RelevanceContextStore,
  WorldActionStepStore,
} from "@nocturne/database";
import { currentGameplayTraceId, writeGameplayTelemetry } from "./gameplay-telemetry.js";

function stableErrorCode(error: unknown, fallback: string) {
  return error instanceof Error &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
    ? String((error as { code: string }).code)
    : fallback;
}

export function instrumentAiClient(
  client: Pick<AiProviderClient, "generateStructured">,
  telemetry?: GameplayTelemetryWriter,
): Pick<AiProviderClient, "generateStructured"> {
  return new Proxy(client, {
    get(target, property, receiver) {
      if (property !== "generateStructured") return Reflect.get(target, property, receiver);
      return async (...args: any[]) => {
        const request = args[0] as { task?: string; requestedModel?: string };
        const startedAt = Date.now();
        const traceId = currentGameplayTraceId(`provider-${request.task || "unknown"}`);
        await writeGameplayTelemetry(telemetry, {
          timestamp: new Date().toISOString(),
          level: "info",
          eventName: "provider_call_started",
          status: "started",
          traceId,
          actionType: request.task,
          model: request.requestedModel,
          committed: false,
        });
        try {
          const result = await (target.generateStructured as (...values: any[]) => Promise<any>)(
            ...args,
          );
          await writeGameplayTelemetry(telemetry, {
            timestamp: new Date().toISOString(),
            level: "info",
            eventName: "provider_call_completed",
            status: "completed",
            traceId,
            actionType: request.task,
            provider: result.provider,
            model: result.actualModel || result.requestedModel,
            providerRequestId: result.providerRequestId,
            attempt: result.attempts,
            durationMs: Date.now() - startedAt,
            committed: false,
          });
          return result;
        } catch (error) {
          await writeGameplayTelemetry(telemetry, {
            timestamp: new Date().toISOString(),
            level: "error",
            eventName: "provider_call_failed",
            status: "failed",
            traceId,
            actionType: request.task,
            model: request.requestedModel,
            errorCode: stableErrorCode(error, "provider_failure"),
            durationMs: Date.now() - startedAt,
            committed: false,
          });
          throw error;
        }
      };
    },
  }) as Pick<AiProviderClient, "generateStructured">;
}

export function instrumentContextStore(
  store: RelevanceContextStore,
  telemetry?: GameplayTelemetryWriter,
): RelevanceContextStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property !== "compile") return Reflect.get(target, property, receiver);
      return async (...args: any[]) => {
        const input = args[0] as {
          scope: { worldId: string; shardId: string; userId: string };
          viewpointId: string;
          command: string;
        };
        const traceId = currentGameplayTraceId(`context-${input.viewpointId}`);
        const startedAt = Date.now();
        await writeGameplayTelemetry(telemetry, {
          timestamp: new Date().toISOString(),
          level: "info",
          eventName: "context_compilation_started",
          status: "started",
          traceId,
          worldId: input.scope.worldId,
          shardId: input.scope.shardId,
          userId: input.scope.userId,
          actorId: input.viewpointId,
          committed: false,
        });
        const result = await (target.compile as (...values: any[]) => Promise<any>)(...args);
        await writeGameplayTelemetry(telemetry, {
          timestamp: new Date().toISOString(),
          level: "info",
          eventName: "context_compilation_completed",
          status: "completed",
          traceId,
          worldId: input.scope.worldId,
          shardId: input.scope.shardId,
          userId: input.scope.userId,
          actorId: input.viewpointId,
          durationMs: Date.now() - startedAt,
          committed: false,
          details: {
            compilationId: result.compilationId,
            playerKnownFactCount: result.playerKnownFacts?.length || 0,
            hiddenFactCount: result.authoritativeHiddenFacts?.length || 0,
          },
        });
        return result;
      };
    },
  }) as RelevanceContextStore;
}

export function instrumentReferenceStore(
  store: ReferenceResolutionStore,
  telemetry?: GameplayTelemetryWriter,
): ReferenceResolutionStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === "buildCandidates") {
        return async (...args: any[]) => {
          const input = args[0] as {
            scope: { worldId: string; shardId: string; userId: string };
            viewpointId: string;
          };
          await writeGameplayTelemetry(telemetry, {
            timestamp: new Date().toISOString(),
            level: "info",
            eventName: "reference_resolution_started",
            status: "started",
            traceId: currentGameplayTraceId(`references-${input.viewpointId}`),
            worldId: input.scope.worldId,
            shardId: input.scope.shardId,
            userId: input.scope.userId,
            actorId: input.viewpointId,
            committed: false,
          });
          return (target.buildCandidates as (...values: any[]) => Promise<any>)(...args);
        };
      }
      if (property === "recordInterpretation") {
        return async (...args: any[]) => {
          const input = args[0] as {
            scope: { worldId: string; shardId: string; userId: string };
            viewpointId: string;
            interpretation: { mentions?: unknown[] };
          };
          const result = await (target.recordInterpretation as (...values: any[]) => Promise<any>)(
            ...args,
          );
          await writeGameplayTelemetry(telemetry, {
            timestamp: new Date().toISOString(),
            level: "info",
            eventName: "reference_resolution_completed",
            status: "completed",
            traceId: currentGameplayTraceId(`references-${input.viewpointId}`),
            worldId: input.scope.worldId,
            shardId: input.scope.shardId,
            userId: input.scope.userId,
            actorId: input.viewpointId,
            committed: false,
            details: { mentionCount: input.interpretation.mentions?.length || 0 },
          });
          return result;
        };
      }
      return Reflect.get(target, property, receiver);
    },
  }) as ReferenceResolutionStore;
}

export function instrumentPlanStore(
  store: PersistentPlanStore,
  telemetry?: GameplayTelemetryWriter,
): PersistentPlanStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === "create") {
        return async (...args: any[]) => {
          const input = args[0] as {
            scope: { worldId: string; shardId: string; userId: string };
            actorId: string;
          };
          const result = await (target.create as (...values: any[]) => Promise<any>)(...args);
          await writeGameplayTelemetry(telemetry, {
            timestamp: new Date().toISOString(),
            level: "info",
            eventName: "plan_created",
            status: "completed",
            traceId: currentGameplayTraceId(result.planId),
            planId: result.planId,
            worldId: input.scope.worldId,
            shardId: input.scope.shardId,
            userId: input.scope.userId,
            actorId: input.actorId,
            committed: true,
          });
          return result;
        };
      }
      if (property === "startReadyStep") {
        return async (...args: any[]) => {
          const input = args[0] as { scope: { worldId: string; shardId: string }; planId: string };
          const result = await (target.startReadyStep as (...values: any[]) => Promise<any>)(
            ...args,
          );
          if (result?.stepId) {
            await writeGameplayTelemetry(telemetry, {
              timestamp: new Date().toISOString(),
              level: "info",
              eventName: "step_claimed",
              status: "started",
              traceId: currentGameplayTraceId(input.planId),
              planId: input.planId,
              stepId: result.stepId,
              worldId: input.scope.worldId,
              shardId: input.scope.shardId,
              committed: false,
            });
          }
          return result;
        };
      }
      if (property === "completeStep") {
        return async (...args: any[]) => {
          const input = args[0] as {
            scope: { worldId: string; shardId: string };
            planId: string;
            stepId: string;
            resultEventId: string;
            resultReceiptId?: string;
          };
          const result = await (target.completeStep as (...values: any[]) => Promise<any>)(...args);
          await writeGameplayTelemetry(telemetry, {
            timestamp: new Date().toISOString(),
            level: "info",
            eventName: "step_completed",
            status: "completed",
            traceId: currentGameplayTraceId(input.planId),
            planId: input.planId,
            stepId: input.stepId,
            eventId: input.resultEventId,
            mutationReceiptId: input.resultReceiptId,
            worldId: input.scope.worldId,
            shardId: input.scope.shardId,
            committed: true,
          });
          return result;
        };
      }
      return Reflect.get(target, property, receiver);
    },
  }) as PersistentPlanStore;
}

export function instrumentStepStore(
  store: WorldActionStepStore,
  telemetry?: GameplayTelemetryWriter,
): WorldActionStepStore {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property !== "markWaiting") return Reflect.get(target, property, receiver);
      return async (...args: any[]) => {
        const input = args[0] as {
          scope: { worldId: string };
          planId: string;
          stepId: string;
          scheduleId?: string;
          reason: string;
        };
        const result = await (target.markWaiting as (...values: any[]) => Promise<any>)(...args);
        await writeGameplayTelemetry(telemetry, {
          timestamp: new Date().toISOString(),
          level: "info",
          eventName: "step_waiting",
          status: "waiting",
          traceId: currentGameplayTraceId(input.planId),
          planId: input.planId,
          stepId: input.stepId,
          scheduleId: input.scheduleId,
          worldId: input.scope.worldId,
          committed: true,
          details: { reason: input.reason },
        });
        return result;
      };
    },
  }) as WorldActionStepStore;
}
