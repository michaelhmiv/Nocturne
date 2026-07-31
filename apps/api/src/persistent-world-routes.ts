import type { FastifyInstance, FastifyRequest } from "fastify";
import { WorldActionRequestSchema } from "../../../packages/contracts/src/world-action.js";
import { OperatorRepairRequestSchema } from "../../../packages/contracts/src/world-inspector.js";
import type { WorldScope } from "@nocturne/database";
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

export async function registerPersistentWorldRoutes(
  app: FastifyInstance,
  dependencies: {
    actions: PersistentWorldActionService;
    scene: PersistentSceneStoreLike;
    inspector: WorldInspectorStoreLike;
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

  app.get("/v1/persistent-world/scene", async (request, reply) => {
    const scope = await scopeFor(request);
    const actorId = scope.selectedCharacterId;
    if (!actorId) {
      return reply.code(409).send({
        error: "actor_required",
        message: "Select a character before loading the persistent world scene.",
      });
    }
    return dependencies.scene.build({ scope, actorId });
  });

  app.post("/v1/persistent-world/actions", async (request, reply) => {
    const scope = await scopeFor(request);
    const body = WorldActionRequestSchema.parse(request.body);
    const actorId = body.actorId || scope.selectedCharacterId;
    if (!actorId) {
      return reply.code(409).send({
        error: "actor_required",
        message: "Select a character before acting in the persistent world.",
      });
    }
    const idempotencyKey = String(request.headers["idempotency-key"] || "").trim();
    if (!idempotencyKey) {
      return reply.code(400).send({
        error: "idempotency_key_required",
        message: "The idempotency-key header is required.",
      });
    }
    const result = await dependencies.actions.submit({
      scope,
      actorId,
      command: body.command,
      idempotencyKey,
    });
    return reply.code(result.state === "completed" ? 200 : 202).send(result);
  });

  app.get("/v1/operator/world/entities/:entityId", async (request) => {
    const scope = await scopeFor(request, true);
    const entityId = String((request.params as { entityId?: string }).entityId || "");
    return dependencies.inspector.inspect({ scope, entityId });
  });

  app.post("/v1/operator/world/repairs", async (request) => {
    const scope = await scopeFor(request, true);
    const repair = OperatorRepairRequestSchema.parse(request.body);
    return dependencies.inspector.repair({ scope, request: repair });
  });
}
