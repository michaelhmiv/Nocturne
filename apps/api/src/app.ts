import cors from "@fastify/cors";
import { createModelPolicy, OpenRouterClient } from "@nocturne/ai-gm";
import { closeAuthFromEnv, getAuthFromEnv, getSessionFromNodeHeaders } from "@nocturne/auth";
import { validateGeneratedContent } from "@nocturne/content-engine";
import {
  ActionStoreError,
  AgentStoreError,
  AuthoritativeContextError,
  createActionStore,
  createAgentStore,
  createAuthoritativeContextStore,
  createConversationStore,
  createDatabase,
  createInventionStore,
  createLocationStore,
  createMarketStore,
  createPersistentWorldStore,
  executeConversationStateOperations,
  InventionStoreError,
  MarketStoreError,
  PersistentWorldError,
  ConversationStoreError,
  StateOperationExecutorError,
} from "@nocturne/database";
import Fastify from "fastify";
import { z, ZodError } from "zod";
import { registerAgentRoutes } from "./agent-routes.js";
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
  const actions = createActionService(createActionStore(database), process.env, locations);
  const market = createMarketStore(database);
  const agents = createAgentStore(database);
  const conversationTurns = createConversationStore(database);
  const context = createAuthoritativeContextStore(database);
  const conversations = createConversationService({
    client: new OpenRouterClient({
      apiKey: process.env.OPENROUTER_API_KEY,
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
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      request.log.error({ body: request.body, method: request.method, url: request.url }, "request validation failed");
      return reply.code(400).send({ error: "invalid_request", issues: error.issues });
    }
    if (
      error instanceof PersistentWorldError ||
      error instanceof InventionStoreError ||
      error instanceof ActionStoreError ||
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
                error.code === "insufficient_funds"
              ? 409
              : 422;
      return reply.code(status).send({ error: error.code, message: error.message });
    }
    const providerCode =
      error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : null;
    if (providerCode) {
      app.log.error(error);
      return reply.code(providerCode === "configuration" ? 503 : 502).send({
        error: providerCode,
        message: "AI provider request failed.",
      });
    }
    app.log.error(error);
    return reply.code(500).send({ error: "internal_error" });
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "api",
    openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY),
  }));
  app.get("/v1/me", async (request, reply) => {
    const session = await getSessionFromNodeHeaders(request.headers);
    return session
      ? { user: session.user, session: session.session }
      : reply.code(401).send({ error: "unauthorized" });
  });
  app.get("/v1/system/model-policy", async () => ({
    authoritative: createModelPolicy({ task: "parse_intent" }),
    creative: createModelPolicy({ task: "narrate_event" }),
  }));
  app.post("/v1/content/validate", async (request, reply) => {
    const result = validateGeneratedContent(request.body);
    return result.status === "invalid" ? reply.code(422).send(result) : result;
  });

  app.post("/v1/characters", async (request, reply) => {
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
    const user = await requireUser(request.headers);
    return { characters: await world.listCharacters(user.id) };
  });
  app.get<{ Params: { id: string } }>("/v1/characters/:id", async (request, reply) => {
    const user = await requireUser(request.headers);
    const character = await world.getCharacter(user.id, request.params.id);
    return character || reply.code(404).send({ error: "not_found" });
  });
  app.post<{ Params: { id: string } }>("/v1/characters/:id/select", async (request) => {
    const user = await requireUser(request.headers);
    return world.selectCharacter(user.id, request.params.id);
  });
  app.get("/v1/world/start", async (request) => {
    await requireUser(request.headers);
    return world.getStarterWorld();
  });
  app.post("/v1/residences/starter/rent", async (request, reply) => {
    const user = await requireUser(request.headers);
    const result = await world.rentStarterResidence(
      user.id,
      request.body,
      request.headers["idempotency-key"] as string | undefined,
    );
    return reply.code(result.alreadyRented ? 200 : 201).send(result);
  });

  app.post("/v1/inventions/normalize", async (request, reply) => {
    const user = await requireUser(request.headers);
    return reply.code(202).send(await inventions.normalize(user.id, request.body));
  });
  app.get("/v1/inventions", async (request) => {
    const user = await requireUser(request.headers);
    return { inventions: await inventions.list(user.id) };
  });
  app.get<{ Params: { requestId: string } }>("/v1/inventions/:requestId", async (request) => {
    const user = await requireUser(request.headers);
    return inventions.get(user.id, request.params.requestId);
  });
  app.post<{ Params: { requestId: string } }>(
    "/v1/inventions/:requestId/install",
    async (request, reply) => {
      const user = await requireUser(request.headers);
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
    const user = await requireUser(request.headers);
    const actorId = z
      .string()
      .uuid()
      .parse((request.query as { actorId?: string }).actorId);
    return { actions: await actions.list(user.id, actorId) };
  });
  app.post("/v1/actions", async (request) => {
    const user = await requireUser(request.headers);
    return actions.execute(
      user.id,
      request.body,
      request.headers["idempotency-key"] as string | undefined,
    );
  });

  // --- Marketplace ---
  app.get("/v1/market/listings", async (request) => {
    await requireUser(request.headers);
    return { listings: await market.listActive() };
  });
  app.post("/v1/market/listings", async (request, reply) => {
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
    return reply.code(201).send(await market.createListing(body));
  });
  app.post("/v1/market/buy", async (request) => {
    const user = await requireUser(request.headers);
    const body = z
      .object({ buyerId: z.string().uuid(), listingId: z.string().uuid() })
      .parse(request.body);
    return market.buy(body);
  });
  app.post("/v1/market/cancel", async (request) => {
    await requireUser(request.headers);
    const body = z
      .object({ sellerId: z.string().uuid(), listingId: z.string().uuid() })
      .parse(request.body);
    return market.cancel(body);
  });

  // --- Vehicles ---
  app.get("/v1/vehicles", async (request) => {
    await requireUser(request.headers);
    const ownerId = (request.query as { ownerId?: string }).ownerId;
    return { vehicles: await locations.listVehicles(ownerId) };
  });
  app.post("/v1/vehicles/claim", async (request, reply) => {
    await requireUser(request.headers);
    const body = z
      .object({ ownerId: z.string().uuid(), vehicleId: z.string().uuid() })
      .parse(request.body);
    const claimed = await locations.claimVehicle(body.ownerId, body.vehicleId);
    if (!claimed) return reply.code(409).send({ error: "unavailable", message: "Vehicle not free." });
    return reply.code(201).send(claimed);
  });
  app.get("/v1/travel/path", async (request) => {
    await requireUser(request.headers);
    const q = z
      .object({
        from: z.string().uuid(),
        to: z.string().uuid(),
        speedFactor: z.coerce.number().positive().optional(),
      })
      .parse(request.query);
    const path = await locations.findShortestPath(q.from, q.to, q.speedFactor ?? 1);
    return path || { path: null, totalTimeSeconds: null };
  });

  app.get("/v1/comms", async (request) => {
    await requireUser(request.headers);
    const actorId = z.string().uuid().parse((request.query as { actorId?: string }).actorId);
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
    const user = await requireUser(request.headers);
    return { messages: await conversationTurns.listPlayerSafeHistory(user.id, request.params.id) };
  });

  app.addHook("onClose", async () => {
    await Promise.all([closeAuthFromEnv(), database.close()]);
  });
  return app;
}
