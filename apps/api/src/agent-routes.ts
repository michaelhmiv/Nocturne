import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type {
  AgentIdentity,
  createAgentStore,
  createLocationStore,
  createMarketStore,
} from "@nocturne/database";
import { AgentStoreError } from "@nocturne/database";
import type { createActionService } from "./action-service.js";
import { requireAgentScope, requireBoundCharacter } from "./agent-scope.js";
import type { createPersistentWorldService } from "./persistent-world.js";

type User = { id: string; name?: string | null; email?: string | null };

type Deps = {
  agents: ReturnType<typeof createAgentStore>;
  world: ReturnType<typeof createPersistentWorldService>;
  actions: ReturnType<typeof createActionService>;
  market: ReturnType<typeof createMarketStore>;
  locations: ReturnType<typeof createLocationStore>;
  requireUser: (headers: Record<string, string | string[] | undefined>) => Promise<User>;
  tryAgent: (headers: Record<string, string | string[] | undefined>) => Promise<AgentIdentity | null>;
};

function headerString(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function requireIdempotencyKey(headers: Record<string, string | string[] | undefined>): string {
  return z.string().trim().min(1).max(256).parse(headerString(headers, "idempotency-key"));
}

export function registerAgentRoutes(app: FastifyInstance, deps: Deps) {
  const { agents, world, actions, market, locations, requireUser, tryAgent } = deps;

  function bootstrapAllowed(headers: Record<string, string | string[] | undefined>) {
    const required = process.env.NOCTURNE_AGENT_BOOTSTRAP_KEY;
    if (!required) {
      return (
        process.env.NOCTURNE_GUEST_MODE === "true" ||
        process.env.NOCTURNE_AGENT_OPEN_REGISTRATION === "true"
      );
    }
    return headerString(headers, "x-nocturne-bootstrap-key") === required;
  }

  async function requireActor(headers: Record<string, string | string[] | undefined>) {
    const agent = await tryAgent(headers);
    if (agent) return { user: { id: agent.userId, name: agent.label }, agent };
    const user = await requireUser(headers);
    return { user, agent: null as AgentIdentity | null };
  }

  async function resolveCharacterId(
    userId: string,
    agent: AgentIdentity | null,
    explicit?: string | null,
  ) {
    requireBoundCharacter(agent, explicit);
    let characterId = explicit || agent?.boundCharacterId || null;
    if (!characterId) {
      const list = await world.listCharacters(userId);
      characterId = (list.find((character) => character.selected) || list[0])?.characterId || null;
    }
    if (!characterId) return null;
    const character = await world.getCharacter(userId, characterId);
    if (!character) {
      throw new AgentStoreError("forbidden", "Character is not available to this account.");
    }
    return characterId;
  }

  // --- Token lifecycle ---

  app.post("/v1/agent/bootstrap", async (request, reply) => {
    if (!bootstrapAllowed(request.headers)) {
      return reply.code(403).send({
        error: "forbidden",
        message:
          "Agent bootstrap disabled. Set NOCTURNE_AGENT_BOOTSTRAP_KEY or enable open registration.",
      });
    }
    const body = z.object({ label: z.string().min(1).max(80).optional() }).parse(request.body ?? {});
    const minted = await agents.bootstrap({ label: body.label });
    return reply.code(201).send({
      tokenId: minted.tokenId,
      token: minted.token,
      prefix: minted.prefix,
      userId: minted.userId,
      label: minted.label,
      hint: "Store token securely. It will not be shown again. Use Authorization: Bearer <token>.",
    });
  });

  app.post("/v1/agent/tokens", async (request, reply) => {
    const { user, agent } = await requireActor(request.headers);
    requireAgentScope(agent, "agent:manage");
    const body = z
      .object({
        label: z.string().min(1).max(80).optional(),
        boundCharacterId: z.string().uuid().nullable().optional(),
        scopes: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
      })
      .parse(request.body ?? {});
    if (body.boundCharacterId) {
      const character = await world.getCharacter(user.id, body.boundCharacterId);
      if (!character) {
        throw new AgentStoreError("forbidden", "Character is not available to this account.");
      }
    }
    const minted = await agents.createToken({
      userId: user.id,
      label: body.label,
      boundCharacterId: body.boundCharacterId,
      scopes: body.scopes,
    });
    return reply.code(201).send({
      tokenId: minted.tokenId,
      token: minted.token,
      prefix: minted.prefix,
      userId: minted.userId,
      label: minted.label,
      hint: "Store token securely. It will not be shown again.",
    });
  });

  app.get("/v1/agent/tokens", async (request) => {
    const { user, agent } = await requireActor(request.headers);
    requireAgentScope(agent, "agent:manage");
    return { tokens: await agents.listTokens(user.id) };
  });

  app.delete<{ Params: { tokenId: string } }>("/v1/agent/tokens/:tokenId", async (request) => {
    const { user, agent } = await requireActor(request.headers);
    requireAgentScope(agent, "agent:manage");
    return agents.revokeToken(user.id, request.params.tokenId);
  });

  app.get("/v1/agent/me", async (request) => {
    const agent = await tryAgent(request.headers);
    if (!agent) {
      const user = await requireUser(request.headers);
      return { auth: "user", userId: user.id, name: user.name, agent: null };
    }
    return {
      auth: "agent",
      userId: agent.userId,
      label: agent.label,
      tokenId: agent.tokenId,
      boundCharacterId: agent.boundCharacterId,
      scopes: agent.scopes,
    };
  });

  app.post("/v1/agent/bind", async (request) => {
    const agent = await tryAgent(request.headers);
    if (!agent) throw new AgentStoreError("forbidden", "Agent token required to bind.");
    requireAgentScope(agent, "agent:manage");
    const body = z.object({ characterId: z.string().uuid().nullable() }).parse(request.body);
    if (body.characterId) {
      const character = await world.getCharacter(agent.userId, body.characterId);
      if (!character) throw new AgentStoreError("not_found", "Character not found for this agent.");
      await world.selectCharacter(agent.userId, body.characterId);
    }
    return agents.bindCharacter(agent.tokenId, agent.userId, body.characterId);
  });

  // --- Play surface (agent-friendly) ---

  app.get("/v1/agent/status", async (request, reply) => {
    const { user, agent } = await requireActor(request.headers);
    requireAgentScope(agent, "character:read");
    const characterId = await resolveCharacterId(user.id, agent);
    if (!characterId) {
      return reply.code(404).send({
        error: "no_character",
        message: "No character bound. Create one with POST /v1/agent/characters.",
      });
    }
    const character = await world.getCharacter(user.id, characterId);
    if (!character) return reply.code(404).send({ error: "not_found" });
    return {
      character,
      cashDollars: ((character.cashOnPerson ?? 0) / 100).toFixed(2),
      heat: character.heat ?? 0,
      warrant: character.warrant ?? false,
      status: character.status ?? "active",
      inventory: character.inventory ?? [],
      skills: character.skills ?? {},
      factions: character.factionStanding ?? {},
    };
  });

  app.post("/v1/agent/characters", async (request, reply) => {
    const { user, agent } = await requireActor(request.headers);
    requireAgentScope(agent, "character:write");
    const body = z
      .object({
        name: z.string().min(1).max(80),
        conceptSummary: z.string().min(1).max(500),
        bind: z.boolean().optional().default(true),
      })
      .parse(request.body);
    const created = await world.createCharacter(
      user.id,
      { name: body.name, conceptSummary: body.conceptSummary },
      headerString(request.headers, "idempotency-key"),
    );
    await world.selectCharacter(user.id, created.characterId);
    if (agent && body.bind) {
      await agents.bindCharacter(agent.tokenId, agent.userId, created.characterId);
    }
    return reply.code(201).send(created);
  });

  app.get("/v1/agent/characters", async (request) => {
    const { user, agent } = await requireActor(request.headers);
    requireAgentScope(agent, "character:read");
    return { characters: await world.listCharacters(user.id) };
  });

  app.post("/v1/agent/rent", async (request, reply) => {
    const { user, agent } = await requireActor(request.headers);
    requireAgentScope(agent, "character:write");
    const body = z.object({ characterId: z.string().uuid().optional() }).parse(request.body ?? {});
    const characterId = await resolveCharacterId(user.id, agent, body.characterId);
    if (!characterId) {
      return reply
        .code(404)
        .send({ error: "no_character", message: "Bind or create a character first." });
    }
    const result = await world.rentStarterResidence(
      user.id,
      { characterId },
      headerString(request.headers, "idempotency-key"),
    );
    return reply.code(result.alreadyRented ? 200 : 201).send(result);
  });

  app.post("/v1/agent/act", async (request) => {
    const { user, agent } = await requireActor(request.headers);
    requireAgentScope(agent, "action:submit");
    const body = z
      .object({
        text: z.string().min(1).max(4000),
        characterId: z.string().uuid().optional(),
      })
      .parse(request.body);
    const characterId = await resolveCharacterId(user.id, agent, body.characterId);
    if (!characterId) {
      throw new AgentStoreError("not_found", "No character bound. Create one first.");
    }
    const result = await actions.execute(
      user.id,
      { actorId: characterId, rawText: body.text },
      headerString(request.headers, "idempotency-key"),
    );
    const status = await world.getCharacter(user.id, characterId);
    return { ...result, character: status };
  });

  app.get("/v1/agent/history", async (request) => {
    const { user, agent } = await requireActor(request.headers);
    requireAgentScope(agent, "character:read");
    const query = z.object({ characterId: z.string().uuid().optional() }).parse(request.query ?? {});
    const characterId = await resolveCharacterId(user.id, agent, query.characterId);
    if (!characterId) return { actions: [] };
    return { actions: await actions.list(user.id, characterId) };
  });

  app.get("/v1/agent/market", async (request) => {
    const { agent } = await requireActor(request.headers);
    requireAgentScope(agent, "market:read");
    return { listings: await market.listActive() };
  });

  app.post("/v1/agent/market/buy", async (request) => {
    const { user, agent } = await requireActor(request.headers);
    requireAgentScope(agent, "market:trade");
    requireIdempotencyKey(request.headers);
    const body = z
      .object({
        listingId: z.string().uuid(),
        characterId: z.string().uuid().optional(),
      })
      .parse(request.body);
    const characterId = await resolveCharacterId(user.id, agent, body.characterId);
    if (!characterId) throw new AgentStoreError("not_found", "No character bound.");
    // TODO: persist the mutation idempotency key in the market store.
    return market.buy({ buyerId: characterId, listingId: body.listingId });
  });

  app.get("/v1/agent/vehicles", async (request) => {
    const { user, agent } = await requireActor(request.headers);
    requireAgentScope(agent, "vehicle:read");
    const characterId = await resolveCharacterId(user.id, agent);
    return {
      available: await locations.listVehicles(),
      mine: characterId ? await locations.listVehicles(characterId) : [],
    };
  });

  app.post("/v1/agent/vehicles/claim", async (request, reply) => {
    const { user, agent } = await requireActor(request.headers);
    requireAgentScope(agent, "vehicle:claim");
    requireIdempotencyKey(request.headers);
    const body = z
      .object({
        vehicleId: z.string().uuid(),
        characterId: z.string().uuid().optional(),
      })
      .parse(request.body);
    const characterId = await resolveCharacterId(user.id, agent, body.characterId);
    if (!characterId) throw new AgentStoreError("not_found", "No character bound.");
    // TODO: persist the mutation idempotency key in the location store.
    const claimed = await locations.claimVehicle(characterId, body.vehicleId);
    if (!claimed)
      return reply.code(409).send({ error: "unavailable", message: "Vehicle not free." });
    return reply.code(201).send(claimed);
  });
}
