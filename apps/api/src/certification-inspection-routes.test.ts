import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type { WorldScope } from "@nocturne/database";
import type { PersistentWorldActionService } from "./persistent-world-action-service.js";
import { registerPersistentWorldRoutes } from "./persistent-world-routes.js";

const entityId = "40000000-0000-4000-8000-000000000001";
const token = "noct_cert_" + "A".repeat(64);
const scope: WorldScope = {
  worldId: "00000000-0000-4000-8000-000000000001",
  shardId: "00000000-0000-4000-8000-000000000002",
  userId: "ordinary-player",
  role: "player",
  selectedCharacterId: entityId,
};

async function setup() {
  const app = Fastify({ logger: false });
  const inspect = vi.fn().mockResolvedValue({ entityId, scope: "operator" });
  const inspectCertified = vi.fn().mockResolvedValue({ entityId, scope: "certified" });
  const repair = vi.fn().mockResolvedValue({ status: "completed" });
  const resolveScope = vi.fn().mockResolvedValue(scope);
  await registerPersistentWorldRoutes(app, {
    actions: {} as PersistentWorldActionService,
    scene: { build: vi.fn() },
    inspector: { inspect, inspectCertified, repair },
    resolveScope,
    isRuntimeEnabled: async () => true,
  });
  await app.ready();
  return { app, inspect, inspectCertified, repair, resolveScope };
}

describe("read-only certification inspection HTTP boundary", () => {
  it("rejects ordinary player cookies/tokens as inspection credentials", async () => {
    const { app, inspectCertified } = await setup();
    try {
      const result = await app.inject({
        method: "GET",
        url: "/v1/certification/world/entities/" + entityId,
      });
      expect(result.statusCode).toBe(403);
      expect(result.json()).toMatchObject({ error: "forbidden" });
      expect(inspectCertified).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("delegates ONLY the separate certification token, not a selected character role", async () => {
    const { app, inspectCertified, resolveScope } = await setup();
    try {
      const result = await app.inject({
        method: "GET",
        url: "/v1/certification/world/entities/" + entityId,
        headers: { "x-nocturne-certification-token": token },
      });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({ scope: "certified" });
      expect(inspectCertified).toHaveBeenCalledTimes(1);
      expect(inspectCertified).toHaveBeenCalledWith({ token, entityId });
      expect(resolveScope).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("rejects invalid entity IDs without invoking credential storage", async () => {
    const { app, inspectCertified } = await setup();
    try {
      const result = await app.inject({
        method: "GET",
        url: "/v1/certification/world/entities/anything",
        headers: { "x-nocturne-certification-token": token },
      });
      expect(result.statusCode).toBe(400);
      expect(inspectCertified).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("does not accept a certification token on the operator inspector or repairs endpoints", async () => {
    const { app, inspect, inspectCertified, repair } = await setup();
    try {
      const headers = { "x-nocturne-certification-token": token };
      const existing = await app.inject({
        method: "GET",
        url: "/v1/operator/world/entities/" + entityId,
        headers,
      });
      expect(existing.statusCode).toBe(403);
      const change = await app.inject({
        method: "POST",
        url: "/v1/operator/world/repairs",
        headers,
        payload: { actionType: "toggle_runtime_feature" },
      });
      expect(change.statusCode).toBe(403);
      expect(inspect).not.toHaveBeenCalled();
      expect(repair).not.toHaveBeenCalled();
      expect(inspectCertified).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("has no POST certification repair surface", async () => {
    const { app, inspectCertified, repair } = await setup();
    try {
      const result = await app.inject({
        method: "POST",
        url: "/v1/certification/world/entities/" + entityId,
        headers: { "x-nocturne-certification-token": token },
        payload: {},
      });
      expect(result.statusCode).toBe(404);
      expect(inspectCertified).not.toHaveBeenCalled();
      expect(repair).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
