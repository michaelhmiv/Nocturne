import {
  WorldActionPlayerSafeResultSchema,
  type WorldActionPlayerSafeResult,
} from "@nocturne/contracts";
import { buildCityTravelPlan } from "@nocturne/ai-gm";
import { compileCityScene, OSM_STARTER_POINT } from "@nocturne/rules-engine";
import type { WorldScope } from "@nocturne/database";
import {
  categoryTravelFrame,
  isCategoryTravelCommand,
  isScenePerceiveCommand,
  missingCityDestinationPrompt,
} from "./category-travel.js";
import {
  createPersistentWorldActionService,
  PersistentWorldActionServiceError,
  type PersistentWorldActionService,
} from "./persistent-world-action-service.js";

type InnerDeps = Parameters<typeof createPersistentWorldActionService>[0];

export type CityAwareActionDependencies = InnerDeps & {
  resolveCityDestination?: (input: {
    scope: WorldScope;
    actorId: string;
    command: string;
    locationId?: string | null;
    lon?: number | null;
    lat?: number | null;
  }) => Promise<{ entityId: string; sourceKey?: string; name?: string } | null>;
  compileLiveScene?: (input: {
    scope: WorldScope;
    actorId: string;
    locationId?: string | null;
  }) => Promise<{ facts: string[]; hereName: string }>;
};

export function createCityAwareWorldActionService(
  dependencies: CityAwareActionDependencies,
): PersistentWorldActionService {
  const inner = createPersistentWorldActionService(dependencies);

  async function submit(input: {
    scope: WorldScope;
    actorId: string;
    command: string;
    idempotencyKey: string;
    clarificationForRequestId?: string;
  }): Promise<WorldActionPlayerSafeResult> {
    if (
      input.clarificationForRequestId ||
      (!isCategoryTravelCommand(input.command) && !isScenePerceiveCommand(input.command))
    ) {
      return inner.submit(input);
    }

    if (isScenePerceiveCommand(input.command)) {
      return submitPerceive(dependencies, inner, input);
    }

    const frame = categoryTravelFrame(input.command);
    const reservation = await dependencies.requests.reserve({
      scope: input.scope,
      actorId: input.actorId,
      command: input.command,
      idempotencyKey: input.idempotencyKey,
    });
    if (!reservation.created) {
      if (reservation.playerSafeResult) return reservation.playerSafeResult;
      throw new PersistentWorldActionServiceError(
        "in_progress",
        "The same world action is already being processed.",
      );
    }

    let currentStatus = "reserved";
    try {
      await dependencies.requests.transition({
        scope: input.scope,
        requestId: reservation.requestId,
        expectedStatus: currentStatus,
        status: "compiling_context",
      });
      currentStatus = "compiling_context";
      const context = await dependencies.context.compile({
        scope: input.scope,
        viewpointId: input.actorId,
        command: input.command,
      });
      await dependencies.requests.transition({
        scope: input.scope,
        requestId: reservation.requestId,
        expectedStatus: currentStatus,
        status: "resolving_references",
        contextCompilationId: context.compilationId,
      });
      currentStatus = "resolving_references";
      const destination = await dependencies.resolveCityDestination?.({
        scope: input.scope,
        actorId: input.actorId,
        command: input.command,
        locationId: context.entities.find((entity) => entity.entityId === input.actorId)
          ?.locationId,
      });
      if (!destination?.entityId) {
        const result = WorldActionPlayerSafeResultSchema.parse({
          state: "waiting_for_clarification",
          requestId: reservation.requestId,
          prompt: frame
            ? missingCityDestinationPrompt(frame)
            : "No matching city destination is loaded.",
        });
        await dependencies.requests.transition({
          scope: input.scope,
          requestId: reservation.requestId,
          expectedStatus: currentStatus,
          status: "waiting_for_clarification",
          playerSafeResult: result,
        });
        return result;
      }

      await dependencies.requests.transition({
        scope: input.scope,
        requestId: reservation.requestId,
        expectedStatus: currentStatus,
        status: "planning",
        contextCompilationId: context.compilationId,
      });
      currentStatus = "planning";
      const proposal = buildCityTravelPlan({
        command: input.command,
        actorId: input.actorId,
        destinationId: destination.entityId,
        destinationName: destination.name,
      });
      const activePlanId = await dependencies.plans.findActive({
        scope: input.scope,
        actorId: input.actorId,
      });
      const plan = await dependencies.plans.create({
        scope: input.scope,
        actorId: input.actorId,
        proposal,
        idempotencyRoot: input.idempotencyKey,
        conflictDecision: activePlanId ? "supersede_existing" : "reject",
      });
      await dependencies.requests.transition({
        scope: input.scope,
        requestId: reservation.requestId,
        expectedStatus: currentStatus,
        status: "executing",
        planId: plan.planId,
        authoritativeResult: {
          semanticMode: "city_source",
          destinationId: destination.entityId,
          sourceKey: destination.sourceKey,
        },
      });
      return inner.executePlan({
        scope: input.scope,
        requestId: reservation.requestId,
        actorId: input.actorId,
        planId: plan.planId,
        context,
      });
    } catch (error) {
      await dependencies.requests
        .transition({
          scope: input.scope,
          requestId: reservation.requestId,
          expectedStatus: currentStatus,
          status: "failed",
          errorCode: "planning_failed",
          authoritativeResult: {
            error: error instanceof Error ? error.message : String(error),
          },
        })
        .catch(() => {});
      throw error;
    }
  }

  return { submit, executePlan: inner.executePlan };
}

async function submitPerceive(
  dependencies: CityAwareActionDependencies,
  _inner: PersistentWorldActionService,
  input: {
    scope: WorldScope;
    actorId: string;
    command: string;
    idempotencyKey: string;
  },
): Promise<WorldActionPlayerSafeResult> {
  const reservation = await dependencies.requests.reserve({
    scope: input.scope,
    actorId: input.actorId,
    command: input.command,
    idempotencyKey: input.idempotencyKey,
  });
  if (!reservation.created) {
    if (reservation.playerSafeResult) return reservation.playerSafeResult;
    throw new PersistentWorldActionServiceError(
      "in_progress",
      "The same world action is already being processed.",
    );
  }

  let currentStatus = "reserved";
  try {
    await dependencies.requests.transition({
      scope: input.scope,
      requestId: reservation.requestId,
      expectedStatus: currentStatus,
      status: "compiling_context",
    });
    currentStatus = "compiling_context";
    const context = await dependencies.context.compile({
      scope: input.scope,
      viewpointId: input.actorId,
      command: input.command,
    });
    await dependencies.requests.transition({
      scope: input.scope,
      requestId: reservation.requestId,
      expectedStatus: currentStatus,
      status: "resolving_references",
      contextCompilationId: context.compilationId,
    });
    currentStatus = "resolving_references";
    const locationId = context.entities.find((entity) => entity.entityId === input.actorId)
      ?.locationId;
    const packet =
      (await dependencies.compileLiveScene?.({
        scope: input.scope,
        actorId: input.actorId,
        locationId,
      })) ||
      compileCityScene({
        lon: OSM_STARTER_POINT.lon,
        lat: OSM_STARTER_POINT.lat,
      });
    await dependencies.requests.transition({
      scope: input.scope,
      requestId: reservation.requestId,
      expectedStatus: currentStatus,
      status: "planning",
      contextCompilationId: context.compilationId,
    });
    currentStatus = "planning";
    const proposal = {
      originalCommand: input.command,
      exclusivePhysical: false,
      steps: [
        {
          order: 1,
          kind: "question" as const,
          description: packet.facts[0] || input.command,
          intentPayload: {
            rawText: input.command,
            actionType: "question",
            facts: packet.facts,
          },
          referencedEntities: [{ entityId: input.actorId, role: "actor" as const }],
        },
      ],
      dependencies: [],
    };
    const plan = await dependencies.plans.create({
      scope: input.scope,
      actorId: input.actorId,
      proposal,
      idempotencyRoot: input.idempotencyKey,
      conflictDecision: "reject",
    });
    await dependencies.requests.transition({
      scope: input.scope,
      requestId: reservation.requestId,
      expectedStatus: currentStatus,
      status: "executing",
      planId: plan.planId,
    });
    currentStatus = "executing";
    const recorded = await dependencies.plans.read({
      scope: input.scope,
      planId: plan.planId,
    });
    const result = WorldActionPlayerSafeResultSchema.parse({
      state: "completed",
      requestId: reservation.requestId,
      plan: {
        ...recorded,
        status: "completed",
      },
      narration: packet.facts.join(" "),
      eventIds: [],
    });
    await dependencies.requests.transition({
      scope: input.scope,
      requestId: reservation.requestId,
      expectedStatus: currentStatus,
      status: "completed",
      playerSafeResult: result,
    });
    return result;
  } catch (error) {
    await dependencies.requests
      .transition({
        scope: input.scope,
        requestId: reservation.requestId,
        expectedStatus: currentStatus,
        status: "failed",
        errorCode: "planning_failed",
        authoritativeResult: {
          error: error instanceof Error ? error.message : String(error),
        },
      })
      .catch(() => {});
    throw error;
  }
}
