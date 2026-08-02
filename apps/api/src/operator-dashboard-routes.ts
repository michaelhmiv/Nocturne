import type { FastifyInstance, FastifyRequest } from "fastify";
import type { OperatorDashboardStore, WorldScope } from "@nocturne/database";

export async function registerOperatorDashboardRoutes(
  app: FastifyInstance,
  dependencies: {
    dashboard: OperatorDashboardStore;
    resolveScope(request: FastifyRequest): Promise<WorldScope>;
  },
) {
  app.get("/v1/operator/world/dashboard/:actorId", async (request, reply) => {
    const scope = await dependencies.resolveScope(request);
    if (!["owner", "operator"].includes(scope.role || "")) {
      return reply.code(403).send({
        error: "forbidden",
        message: "Operator world access is required.",
      });
    }
    const actorId = String((request.params as { actorId?: string }).actorId || "").trim();
    if (!actorId) {
      return reply.code(400).send({
        error: "actor_required",
        message: "An actor ID is required.",
      });
    }
    const query = request.query as { limit?: string | number };
    const requestedLimit = Number(query.limit ?? 50);
    const limit = Number.isFinite(requestedLimit)
      ? Math.max(1, Math.min(Math.trunc(requestedLimit), 100))
      : 50;
    return dependencies.dashboard.build({ scope, actorId, limit });
  });
}
