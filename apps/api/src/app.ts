import cors from "@fastify/cors";
import { AiProviderClient, DEEPSEEK_FLASH_MODEL, createModelPolicy } from "@nocturne/ai-gm";
import { closeAuthFromEnv, getAuthFromEnv, getSessionFromNodeHeaders } from "@nocturne/auth";
import { validateGeneratedContent } from "@nocturne/content-engine";
import {
  ActionStoreError,
  AgentStoreError,
  AuthoritativeContextError,
  ConsumptionStoreError,
  ConversationStoreError,
  InventionStoreError,
  MarketStoreError,
  PersistentWorldError,
  StateOperationExecutorError,
  createActionStore,
  createAgentStore,
  createAuthoritativeContextStore,
  createConsumptionStore,
  createConversationStore,
  createDatabase,
  createInventionStore,
  createLocationStore,
  createMarketStore,
  createPersistentWorldStore,
  createWorldActionRequestStore,
  executeConversationStateOperations,
} from "@nocturne/database";
import Fastify from "fastify";
import { z, ZodError } from "zod";
import { registerAgentRoutes } from "./agent-routes.js";
import { requireAgentScope, requireBoundCharacter, type AgentScope } from "./agent-scope.js";
import { classifyUnhandledApiError } from "./api-error-classification.js";
import { createActionService } from "./action-service.js";
import { ConversationServiceError, createConversationService } from "./conversation-service.js";
import { createInventionService } from "./invention-service.js";
import { createPersistentWorldService } from "./persistent-world.js";

export async function buildApp() {
  getAuthFromEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const database = createDatabase(databaseUrl);
  const world = createPersistentWorldService(createPersistentWorldStore(database));
  const inventions = createInventionService(createInventionStore(database));
  const locations = createLocationStore(database);
  const consumption = createConsumptionStore(database);
  const actions = createActionService(
    createActionStore(database),
    process.env,
    locations,
    consumption,
  );
  const actionHistory = createWorldActionRequestStore(database);
  const market = createMarketStore(database);
  const agents = createAgentStore(database);
  const conversationTurns = createConversationStore(database);
  const context = createAuthoritativeContextStore(database);
  const conversations = createConversationService({
    client: new AiProviderClient({
      deepseekApiKey: process.env.DEEPSEEK_API_KEY,
    }),
    turns: conversationTurns,
    rollSecret: process.env.NOCTURNE_ROLL_SECRET || process.env.BETTER_AUTH_SECRET,
    applyStateOperations: (input) => executeConversationStateOperations(database, input),
    loadContext: async ({ userId }) => {
      try {
        const result = await context.buildContext(userId);
        return {
          viewpointId: result.viewpointId,
          playerKnownFacts: result.playerKnownFacts,
          hiddenFacts: result.authoritativeHiddenFacts,
        };
      } catch (error) {
        if (
          error instanceof AuthoritativeContextError &&
          error.code === "selected_character_not_found"
        )
          return { playerKnownFacts: [], hiddenFacts: [] };
        throw error;
      }
    },
  });
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });
  await app.register(cors, {
    origin: (process.env.BETTER_AUTH_TRUSTED_ORIGINS || "http://localhost:3000")
      .split(",")
      .map((origin) => origin.trim()),
    credentials: true,
  });

  async function tryAgent(headers: Record<string, string | string[] | undefined>) {
    const auth = headers.authorization ?? headers.Authorization;
    const value = Array.isArray(auth) ? auth[0] : auth;
    return agents.authenticate(value);
  }

  async function requireUser(headers: Record<string, string | string[] | undefined>) {
    const agent = await tryAgent(headers);
    if (agent) {
      return {
        id: agent.userId,
        name: agent.label,
        email: `${agent.userId}@agent.nocturne.local`,
      };
    }
    const guestHeader = headers["x-nocturne-guest-mode"];
    if (process.env.NOCTURNE_GUEST_MODE === "true" && guestHeader === "1") {
      return {
        id: process.env.NOCTURNE_GUEST_USER_ID || "nocturne-test-guest",
        name: "Test Guest",
        email: "guest@nocturne.local",
      };
    }
    const session = await getSessionFromNodeHeaders(headers);
    if (!session) throw new PersistentWorldError("forbidden", "Authentication is required.");
    return session.user;
  }

  async function authorizeAgent(
    headers: Record<string, string | string[] | undefined>,
    scope: AgentScope,
    characterId?: string | null,
  ) {
    const agent = await tryAgent(headers);
    requireAgentScope(agent, scope);
    requireBoundCharacter(agent, characterId);
    return agent;
  }

  async function requireOwnedCharacter(userId: string, characterId: string) {
    const character = await world.getCharacter(userId, characterId);
    if (!character) {
      throw new PersistentWorldError("forbidden", "Character is not available to this account.");
    }
    return character;
  }

  function requireIdempotencyKey(headers: Record<string, string | string[] | undefined>) {
    const raw = headers["idempotency-key"];
    return z
      .string()
      .trim()
      .min(1)
      .max(256)
      .parse(Array.isArray(raw) ? raw[0] : raw);
  }

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      request.log.error(
        { method: request.method, url: request.url, issues: error.issues },
        "request validation failed",
      );
      return reply.code(400).send({ error: "invalid_request", issues: error.issues });
    }
    if (
      error instanceof PersistentWorldError ||
      error instanceof InventionStoreError ||
      error instanceof ActionStoreError ||
      error instanceof ConsumptionStoreError ||
      error instanceof MarketStoreError ||
      error instanceof ConversationStoreError ||
      error instanceof AuthoritativeContextError ||
      error instanceof ConversationServiceError ||
      error instanceof StateOperationExecutorError ||
      error instanceof AgentStoreError
    ) {
      const status =
        error.code === "not_found"
          ? 404
          : error.code === "forbidden"
            ? 403
            : error.code === "installation_failed" ||
                error.code === "residence_unavailable" ||
                error.code === "insufficient_funds" ||
                error.code === "unavailable"
              ? 409
              : 422;
      return reply.code(status).send({ error: error.code, message: error.message });
    }

    const classification = classifyUnhandledApiError(error);
    request.log.error(
      {
        err: error,
        errorClass: classification.errorClass,
        sourceCode: classification.sourceCode,
        method: request.method,
        url: request.url,
      },
      "request failed",
    );
    return reply.code(classification.statusCode).send({
      error: classification.errorClass,
      ...(classification.message ? { message: classification.message } : {}),
    });
  });

  const primaryProvider = "deepseek" as const;
  const primaryConfigured = Boolean(process.env.DEEPSEEK_API_KEY);

  app.get("/health", async () => ({
    status: "ok",
    service: "api",
    ai: {
      primaryProvider,
      primaryConfigured,
      model: DEEPSEEK_FLASH_MODEL,
    },
  }));
  app.get("/ready", async (_request, reply) => {
    let databaseReady = false;
    try {
      await database.client`SELECT 1`;
      databaseReady = true;
    } catch (error) {
      app.log.error({ error }, "database readiness check failed");
    }
    const ready = databaseReady && primaryConfigured;
    return reply.code(ready ? 200 : 503).send({
      status: ready ? "ready" : "not_ready",
      service: "api",
      databaseReady,
      aiReady: primaryConfigured,
      primaryProvider,
      model: DEEPSEEK_FLASH_MODEL,
    });
  });
  app.get("/v1/me", async (request, reply) => {
    const session = await getSessionFromNodeHeaders(request.headers);
    return session
      ? { user: session.user, session: session.session }
      : reply.code(401).send({ error: "unauthorized" });
  });
  app.get("/v1/system/model-policy", async () => ({
    authoritative: createModelPolicy({
      task: "parse_intent",
      authoritativeModel: process.env.AI_AUTHORITATIVE_MODEL || process.env.DEEPSEEK_MODEL,
    }),
    creative: createModelPolicy({
      task: "narrate_event",
      creativeModel: process.env.AI_CREATIVE_MODEL || process.env.DEEPSEEK_MODEL,
    }),
  }));
  app.post("/v1/content/validate", async (request, reply) => {
    const result = validateGeneratedContent(request.body);
    return result.status === "invalid" ? reply.code(422).send(result) : result;
  });

  app.post("/v1/characters", async (request, reply) => {
    await authorizeAgent(request.headers, "character:write");
    const user = await requireUser(request.headers);
    return reply
      .code(201)
      .send(
        await world.createCharacter(
          user.id,
          request.body,
          request.headers["idempotency-key"] as string | undefined,
        ),
      );
  });
  app.get("/v1/characters", async (request) => {
    await authorizeAgent(request.headers, "character:read");
    const user = await requireUser(request.headers);
    return { characters: await world.listCharacters(user.id) };
  });
  app.get<{ Params: { id: string } }>("/v1/characters/:id", async (request, reply) => {
    await authorizeAgent(request.headers, "character:read", request.params.id);
    const user = await requireUser(request.headers);
    const character = await world.getCharacter(user.id, request.params.id);
    return character || reply.code(404).send({ error: "not_found" });
  });
  app.post<{ Params: { id: string } }>("/v1/characters/:id/select", async (request) => {
    await authorizeAgent(request.headers, "character:write", request.params.id);
    const user = await requireUser(request.headers);
    return world.selectCharacter(user.id, request.params.id);
  });
  app.get("/v1/world/start", async (request) => {
    await authorizeAgent(request.headers, "character:read");
    await requireUser(request.headers);
    return world.getStarterWorld();
  });
  app.post("/v1/residences/starter/rent", async (request, reply) => {
    const characterId = (request.body as { characterId?: unknown } | null)?.characterId;
    await authorizeAgent(
      request.headers,
      "character:write",
      typeof characterId === "string" ? characterId : undefined,
    );
    const user = await requireUser(request.headers);
    if (typeof characterId === "string") await requireOwnedCharacter(user.id, characterId);
    const result = await world.rentStarterResidence(
      user.id,
      request.body,
      request.headers["idempotency-key"] as string | undefined,
    );
    return reply.code(result.alreadyRented ? 200 : 201).send(result);
  });

  app.post("/v1/inventions/normalize", async (request, reply) => {
    const characterId = (request.body as { characterId?: unknown } | null)?.characterId;
    await authorizeAgent(
      request.headers,
      "character:write",
      typeof characterId === "string" ? characterId : undefined,
    );
    const user = await requireUser(request.headers);
    if (typeof characterId === "string") await requireOwnedCharacter(user.id, characterId);
    return reply.code(202).send(await inventions.normalize(user.id, request.body));
  });
  app.get("/v1/inventions", async (request) => {
    await authorizeAgent(request.headers, "character:read");
    const user = await requireUser(request.headers);
    return { inventions: await inventions.list(user.id) };
  });
  app.get<{ Params: { requestId: string } }>("/v1/inventions/:requestId", async (request) => {
    await authorizeAgent(request.headers, "character:read");
    const user = await requireUser(request.headers);
    return inventions.get(user.id, request.params.requestId);
  });
  app.post<{ Params: { requestId: string } }>(
    "/v1/inventions/:requestId/install",
    async (request, reply) => {
      const characterId = (request.body as { characterId?: unknown } | null)?.characterId;
      await authorizeAgent(
        request.headers,
        "character:write",
        typeof characterId === "string" ? characterId : undefined,
      );
      const user = await requireUser(request.headers);
      if (typeof characterId === "string") await requireOwnedCharacter(user.id, characterId);
      return reply
        .code(201)
        .send(
          await inventions.install(
            user.id,
            request.params.requestId,
            request.body,
            request.headers["idempotency-key"] as string | undefined,
          ),
        );
    },
  );

  app.get("/v1/actions", async (request) => {
    const actorId = z
      .string()
      .uuid()
      .parse((request.query as { actorId?: string }).actorId);
    await authorizeAgent(request.headers, "character:read", actorId);
    const user = await requireUser(request.headers);
    await requireOwnedCharacter(user.id, actorId);
    const [canonical, legacyActions] = await Promise.all([
      actionHistory.listForActor({ userId: user.id, actorId }),
      actions.list(user.id, actorId),
    ]);
    return { actions: canonical, legacyActions };
  });
  app.post("/v1/actions", async (request) => {
    const actorId = (request.body as { actorId?: unknown } | null)?.actorId;
    await authorizeAgent(
      request.headers,
      "action:submit",
      typeof actorId === "string" ? actorId : undefined,
    );
    const user = await requireUser(request.headers);
    if (typeof actorId === "string") await requireOwnedCharacter(user.id, actorId);
    return actions.execute(
      user.id,
      request.body,
      request.headers["idempotency-key"] as string | undefined,
    );
  });

  app.get("/v1/market/listings", async (request) => {
    await authorizeAgent(request.headers, "market:read");
    await requireUser(request.headers);
    return { listings: await market.listActive() };
  });
  app.post("/v1/market/listings", async (request, reply) => {
    await authorizeAgent(request.headers, "market:trade");
    const user = await requireUser(request.headers);
    const body = z
      .object({
        sellerId: z.string().uuid(),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        priceCents: z.number().int().min(0),
        itemInstanceId: z.string().uuid().optional(),
      })
      .parse(request.body);
    await requireOwnedCharacter(user.id, body.sellerId);
    return reply.code(201).send(await market.createListing(body));
  });
  app.post("/v1/market/buy", async (request) => {
    await authorizeAgent(request.headers, "market:trade");
    requireIdempotencyKey(request.headers);
    const user = await requireUser(request.headers);
    const body = z
      .object({ buyerId: z.string().uuid(), listingId: z.string().uuid() })
      .parse(request.body);
    await requireOwnedCharacter(user.id, body.buyerId);
    return market.buy(body);
  });
  app.post("/v1/market/cancel", async (request) => {
    await authorizeAgent(request.headers, "market:trade");
    const user = await requireUser(request.headers);
    const body = z
      .object({ sellerId: z.string().uuid(), listingId: z.string().uuid() })
      .parse(request.body);
    await requireOwnedCharacter(user.id, body.sellerId);
    return market.cancel(body);
  });

  app.get("/v1/vehicles", async (request) => {
    const ownerId = (request.query as { ownerId?: string }).ownerId;
    await authorizeAgent(request.headers, "vehicle:read", ownerId);
    const user = await requireUser(request.headers);
    if (ownerId) await requireOwnedCharacter(user.id, ownerId);
    return { vehicles: await locations.listVehicles(ownerId) };
  });
  app.post("/v1/vehicles/claim", async (request, reply) => {
    await authorizeAgent(request.headers, "vehicle:claim");
    requireIdempotencyKey(request.headers);
    const user = await requireUser(request.headers);
    const body = z
      .object({ ownerId: z.string().uuid(), vehicleId: z.string().uuid() })
      .parse(request.body);
    await requireOwnedCharacter(user.id, body.ownerId);
    const claimed = await locations.claimVehicle(body.ownerId, body.vehicleId);
    if (!claimed)
      return reply.code(409).send({ error: "unavailable", message: "Vehicle not free." });
    return reply.code(201).send(claimed);
  });
  app.get("/v1/travel/path", async (request) => {
    await authorizeAgent(request.headers, "character:read");
    await requireUser(request.headers);
    const query = z
      .object({
        from: z.string().uuid(),
        to: z.string().uuid(),
        speedFactor: z.coerce.number().positive().optional(),
      })
      .parse(request.query);
    const path = await locations.findShortestPath(query.from, query.to, query.speedFactor ?? 1);
    return path || { path: null, totalTimeSeconds: null };
  });

  app.get("/v1/comms", async (request) => {
    const actorId = z
      .string()
      .uuid()
      .parse((request.query as { actorId?: string }).actorId);
    await authorizeAgent(request.headers, "character:read", actorId);
    const user = await requireUser(request.headers);
    await requireOwnedCharacter(user.id, actorId);
    return { messages: await actions.listComms(actorId) };
  });

  registerAgentRoutes(app, {
    agents,
    world,
    actions,
    market,
    locations,
    requireUser,
    tryAgent,
  });

  app.post<{ Params: { id: string } }>("/v1/conversations/:id/messages", async (request) => {
    await authorizeAgent(request.headers, "action:submit");
    const user = await requireUser(request.headers);
    const idempotencyKey = z
      .string()
      .trim()
      .min(1)
      .max(256)
      .parse(request.headers["idempotency-key"]);
    return conversations.submitMessage({
      userId: user.id,
      conversationId: request.params.id,
      idempotencyKey,
      request: request.body,
    });
  });
  app.get<{ Params: { id: string } }>("/v1/conversations/:id/messages", async (request) => {
    await authorizeAgent(request.headers, "character:read");
    const user = await requireUser(request.headers);
    return { messages: await conversationTurns.listPlayerSafeHistory(user.id, request.params.id) };
  });

  app.addHook("onClose", async () => {
    await Promise.all([closeAuthFromEnv(), database.close()]);
  });
  return app;
}
