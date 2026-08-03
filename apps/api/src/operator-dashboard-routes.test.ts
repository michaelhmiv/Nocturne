import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerOperatorDashboardRoutes } from "./operator-dashboard-routes.js";

async function appFor(input: {
  role: "player" | "operator";
  selectedCharacterId: string;
}) {
  const app = Fastify();
  const build = vi.fn(async ({ actorId, limit }: { actorId: string; limit: number }) => ({
    actorId,
    limit,
    requests: [],
  }));
  await registerOperatorDashboardRoutes(app, {
    dashboard: { build } as never,
    resolveScope: async () => ({
      worldId: randomUUID(),
      shardId: randomUUID(),
      userId: "trace-user",
      role: input.role,
      selectedCharacterId: input.selectedCharacterId,
    }),
  });
  return { app, build };
}

describe("operator dashboard routes", () => {
  it("allows a player to read the selected actor's trace dashboard", async () => {
    const actorId = randomUUID();
    const { app, build } = await appFor({ role: "player", selectedCharacterId: actorId });

    const response = await app.inject({
      method: "GET",
      url: `/v1/operator/world/dashboard/${actorId}?limit=25`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ actorId, limit: 25 });
    expect(build).toHaveBeenCalledOnce();
    await app.close();
  });

  it("does not allow a player to inspect another actor", async () => {
    const selectedCharacterId = randomUUID();
    const { app, build } = await appFor({ role: "player", selectedCharacterId });

    const response = await app.inject({
      method: "GET",
      url: `/v1/operator/world/dashboard/${randomUUID()}`,
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "forbidden" });
    expect(build).not.toHaveBeenCalled();
    await app.close();
  });

  it("retains operator access to other actors", async () => {
    const { app, build } = await appFor({
      role: "operator",
      selectedCharacterId: randomUUID(),
    });
    const actorId = randomUUID();

    const response = await app.inject({
      method: "GET",
      url: `/v1/operator/world/dashboard/${actorId}`,
    });

    expect(response.statusCode).toBe(200);
    expect(build).toHaveBeenCalledOnce();
    await app.close();
  });
});
