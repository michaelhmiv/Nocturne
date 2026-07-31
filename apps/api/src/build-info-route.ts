import type { FastifyInstance } from "fastify";

export async function registerBuildInfoRoute(app: FastifyInstance) {
  app.get("/v1/system/build", async () => ({
    commitSha:
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.GITHUB_SHA ||
      process.env.SOURCE_COMMIT ||
      null,
    environment: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || "unknown",
    service: process.env.RAILWAY_SERVICE_NAME || "api",
    deployedAt: process.env.RAILWAY_DEPLOYMENT_START_TIME || null,
  }));
}
