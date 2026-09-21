import Fastify from "fastify";
import type { PlayerDashboardStore, WorldScope } from "@nocturne/database";
import { describe, expect, it, vi } from "vitest";
import { registerPlayerDashboardRoutes } from "./player-dashboard-routes.js";

const actorId = "40000000-0000-4000-8000-000000000001";
const strangerId = "40000000-0000-4000-8000-000000000002";

async function setup(selectedCharacterId: string | null) {
  const app = Fastify({ logger: false });
  const build = vi.fn().mockResolvedValue({ actorId, character: { characterId: actorId } });
  const scope: WorldScope = {
    worldId: "00000000-0000-4000-8000-000000000001",
    shardId: "00000000-0000-4000-8000-000000000002",
    userId: "player-with-no-operator-role",
    role: "player",
    selectedCharacterId,
  };
  await registerPlayerDashboardRoutes(app, {
    dashboard: { build } as unknown as PlayerDashboardStore,
    resolveScope: async () => scope,
  });
  await app.ready();
  return { app, build };
}

describe("player dashboard actor authorization", () => {
  it("rejects another user's actor before a new account selects a character", async () => {
    const { app, build } = await setup(null);
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/persistent-world/dashboard?actorId=" + strangerId,
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: "forbidden" });
      expect(build).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("requires character selection even when a valid-looking actor ID is given", async () => {
    const { app, build } = await setup(null);
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/persistent-world/dashboard?actorId=" + actorId,
      });
      expect(response.statusCode).toBe(403);
      expect(build).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("returns actor_required rather than allowing anonymous dashboard selection", async () => {
    const { app, build } = await setup(null);
    try {
      const response = await app.inject({
        method: "GET",
        url: "/v1/persistent-world/dashboard",
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ error: "actor_required" });
      expect(build).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("allows only the selected actor's dashboard and rejects a different actor", async () => {
    const { app, build } = await setup(actorId);
    try {
      const own = await app.inject({
        method: "GET",
        url: "/v1/persistent-world/dashboard?historyLimit=9999",
      });
      expect(own.statusCode).toBe(200);
      expect(build).toHaveBeenCalledWith({
        scope: expect.objectContaining({ userId: "player-with-no-operator-role" }),
        actorId,
        historyLimit: 200,
      });

      const wrong = await app.inject({
        method: "GET",
        url: "/v1/persistent-world/dashboard?actorId=" + strangerId,
      });
      expect(wrong.statusCode).toBe(403);
      expect(build).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });
});
