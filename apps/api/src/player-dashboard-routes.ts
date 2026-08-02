import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PlayerDashboardStore, WorldScope } from "@nocturne/database";

export async function registerPlayerDashboardRoutes(
  app: FastifyInstance,
  dependencies: {
    dashboard: PlayerDashboardStore;
    resolveScope(request: FastifyRequest): Promise<WorldScope>;
  },
) {
  app.get("/v1/persistent-world/dashboard", async (request, reply) => {
    const scope = await dependencies.resolveScope(request);
    const query = request.query as { actorId?: string; historyLimit?: string | number };
    const actorId = String(query.actorId || scope.selectedCharacterId || "").trim();
    if (!actorId) {
      return reply.code(409).send({
        error: "actor_required",
        message: "Select a character before loading the dashboard.",
      });
    }
    if (scope.selectedCharacterId && actorId !== scope.selectedCharacterId) {
      return reply.code(403).send({
        error: "forbidden",
        message: "The dashboard is limited to the selected character.",
      });
    }
    const requestedLimit = Number(query.historyLimit ?? 100);
    const historyLimit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(Math.trunc(requestedLimit), 200))
      : 100;
    return dependencies.dashboard.build({ scope, actorId, historyLimit });
  });
}
