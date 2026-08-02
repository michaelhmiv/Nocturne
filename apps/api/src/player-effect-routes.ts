import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PlayerEffectStore, WorldScope } from "@nocturne/database";

export async function registerPlayerEffectRoutes(
  app: FastifyInstance,
  dependencies: {
    effects: PlayerEffectStore;
    resolveScope(request: FastifyRequest): Promise<WorldScope>;
  },
) {
  app.get("/v1/persistent-world/effects", async (request, reply) => {
    const scope = await dependencies.resolveScope(request);
    const query = request.query as { actorId?: string; limit?: string | number };
    const actorId = String(query.actorId || scope.selectedCharacterId || "").trim();
    if (!actorId) {
      return reply.code(409).send({
        error: "actor_required",
        message: "Select a character before loading effect history.",
      });
    }
    if (scope.selectedCharacterId && actorId !== scope.selectedCharacterId) {
      return reply.code(403).send({
        error: "forbidden",
        message: "Effect history is limited to the selected character.",
      });
    }
    const requestedLimit = Number(query.limit ?? 50);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(Math.trunc(requestedLimit), 200))
      : 50;
    return dependencies.effects.list({ scope, actorId, limit });
  });
}
