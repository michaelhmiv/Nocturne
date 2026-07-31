import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  WorldActionKindSchema,
  type GameplayTelemetryWriter,
} from "@nocturne/contracts";
import { WorldActionRequestSchema } from "../../../packages/contracts/src/world-action.js";
import { OperatorRepairRequestSchema } from "../../../packages/contracts/src/world-inspector.js";
import type { WorldScope } from "@nocturne/database";
import {
  createGameplayTraceId,
  hashIdempotencyKey,
  runWithGameplayTrace,
  writeGameplayTelemetry,
} from "./gameplay-telemetry.js";
import type { PersistentWorldActionService } from "./persistent-world-action-service.js";

type PersistentSceneStoreLike = {
  build(input: { scope: WorldScope; actorId: string }): Promise<unknown>;
};

type WorldInspectorStoreLike = {
  inspect(input: { scope: WorldScope; entityId: string }): Promise<unknown>;
  repair(input: { scope: WorldScope; request: unknown }): Promise<unknown>;
};

export class PersistentWorldRouteError extends Error {
  constructor(
    readonly code: "runtime_disabled" | "actor_required" | "forbidden",
    message: string,
  ) {
    super(message);
    this.name = "PersistentWorldRouteError";
  }
}

type CodedError = Error & { code?: unknown };

function errorCode(error: unknown) {
  return error instanceof Error && typeof (error as CodedError).code === "string"
    ? String((error as CodedError).code)
    : null;
}

async function replyWithPersistentError<T>(
  reply: FastifyReply,
  operation: () => Promise<T>,
): Promise<T | FastifyReply> {
  try {
    return await operation();
  } catch (error) {
    const code = errorCode(error);
    if (!code) throw error;
    const message = error instanceof Error ? error.message : "Persistent-world request failed.";
    if (
      [
        "forbidden",
        "cross_world_reference",
        "membership_not_found",
        "membership_inactive",
      ].includes(code)
    ) {
      return reply.code(403).send({ error: code, message });
    }
    if (["actor_required", "in_progress", "stale_entity", "unmet_precondition"].includes(code)) {
      return reply.code(409).send({ error: code, message });
    }
    if (code === "runtime_disabled") {
      return reply.code(503).send({ error: code, message });
    }
    if (
      [
        "configuration",
        "timeout",
        "rate_limited",
        "provider_failure",
        "provider_rejected",
        "malformed_response",
        "validation",
      ].includes(code)
    ) {
      return reply.code(code === "configuration" ? 503 : 502).send({
        error: `ai_${code}`,
        message: "The AI provider could not resolve this turn. No in-world failure was committed.",
      });
    }
    if (
      ["unsupported_handler", "planning_failed", "step_failed", "request_failed"].includes(code)
    ) {
      return reply.code(422).send({
        error: code,
        message:
          "The action could not be resolved by the active world runtime. No in-world failure was committed.",
      });
    }
    return reply.code(422).send({ error: code, message });
  }
}

export async function registerPersistentWorldRoutes(
  app: FastifyInstance,
  dependencies: {
    actions: PersistentWorldActionService;
    scene: PersistentSceneStoreLike;
    inspector: WorldInspectorStoreLike;
    telemetry?: GameplayTelemetryWriter;
    resolveScope(request: FastifyRequest): Promise<WorldScope>;
    isRuntimeEnabled(scope: Pick<WorldScope, "worldId">): Promise<boolean>;
  },
) {
  async function scopeFor(request: FastifyRequest, operator = false) {
    const scope = await dependencies.resolveScope(request);
    if (!(await dependencies.isRuntimeEnabled(scope))) {
      throw new PersistentWorldRouteError(
        "runtime_disabled",
        "Persistent-world runtime is not enabled for this world.",
      );
    }
    if (operator && !["owner", "operator"].includes(scope.role || "")) {
      throw new PersistentWorldRouteError("forbidden", "Operator world access is required.");
    }
    return scope;
  }

  app.get("/v1/persistent-world/scene", async (request, reply) =>
    replyWithPersistentError(reply, async () => {
      const scope = await scopeFor(request);
      const actorId = scope.selectedCharacterId;
      if (!actorId) {
        throw new PersistentWorldRouteError(
          "actor_required",
          "Select a character before loading the persistent world scene.",
        );
      }
      return dependencies.scene.build({ scope, actorId });
    }),
  );

  app.post("/v1/persistent-world/actions", async (request, reply) => {
    const traceId = createGameplayTraceId(
      request.headers["x-nocturne-trace-id"] || request.headers["x-request-id"],
    );
    return runWithGameplayTrace(traceId, () =>
      replyWithPersistentError(reply, async () => {
        const startedAt = Date.now();
        const scope = await scopeFor(request);
        const body = WorldActionRequestSchema.parse(request.body);
        if (body.actorId && body.actorId !== scope.selectedCharacterId) {
          throw new PersistentWorldRouteError(
            "forbidden",
            "The requested actor is not the selected character for this world membership.",
          );
        }
        const actorId = body.actorId || scope.selectedCharacterId;
        if (!actorId) {
          throw new PersistentWorldRouteError(
            "actor_required",
            "Select a character before acting in the persistent world.",
          );
        }
        const idempotencyKey = String(request.headers["idempotency-key"] || "").trim();
        if (!idempotencyKey) {
          return reply.code(400).send({
            error: "idempotency_key_required",
            message: "The idempotency-key header is required.",
          });
        }
        const common = {
          traceId,
          idempotencyKeyHash: hashIdempotencyKey(idempotencyKey),
          worldId: scope.worldId,
          shardId: scope.shardId,
          userId: scope.userId,
          actorId,
        } as const;
        await writeGameplayTelemetry(dependencies.telemetry, {
          ...common,
          level: "info",
          eventName: "request_received",
          status: "started",
          committed: false,
          details: { commandLength: body.command.length },
        });
        await writeGameplayTelemetry(dependencies.telemetry, {
          ...common,
          level: "info",
          eventName: "scope_resolved",
          status: "completed",
          committed: false,
        });
        try {
          const result = await dependencies.actions.submit({
            scope,
            actorId,
            command: body.command,
            idempotencyKey,
          });
          const candidateKind =
            result.state === "waiting_for_clarification" ? undefined : result.plan.steps[0]?.kind;
          const parsedKind = WorldActionKindSchema.safeParse(candidateKind);
          const actionKind = parsedKind.success ? parsedKind.data : undefined;
          await writeGameplayTelemetry(dependencies.telemetry, {
            ...common,
            requestId: result.requestId,
            actionKind,
            level: "info",
            eventName: result.state === "completed" ? "request_completed" : "request_waiting",
            status: result.state === "completed" ? "completed" : "waiting",
            durationMs: Date.now() - startedAt,
            committed: result.state !== "waiting_for_clarification",
            details: { resultState: result.state },
          });
          return reply.code(result.state === "completed" ? 200 : 202).send(result);
        } catch (error) {
          await writeGameplayTelemetry(dependencies.telemetry, {
            ...common,
            level: "error",
            eventName: "request_failed",
            status: "failed",
            errorCode: errorCode(error) || "internal_error",
            durationMs: Date.now() - startedAt,
            committed: false,
            details: {
              errorName: error instanceof Error ? error.name : "UnknownError",
              errorMessage: error instanceof Error ? error.message : String(error),
            },
          });
          throw error;
        }
      }),
    );
  });

  app.get("/v1/operator/world/entities/:entityId", async (request, reply) =>
    replyWithPersistentError(reply, async () => {
      const scope = await scopeFor(request, true);
      const entityId = String((request.params as { entityId?: string }).entityId || "");
      return dependencies.inspector.inspect({ scope, entityId });
    }),
  );

  app.post("/v1/operator/world/repairs", async (request, reply) =>
    replyWithPersistentError(reply, async () => {
      const scope = await scopeFor(request, true);
      const repair = OperatorRepairRequestSchema.parse(request.body);
      return dependencies.inspector.repair({ scope, request: repair });
    }),
  );
}
