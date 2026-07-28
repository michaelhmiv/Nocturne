import cors from "@fastify/cors";
import { createModelPolicy } from "@nocturne/ai-gm";
import { closeAuthFromEnv, getAuthFromEnv, getSessionFromNodeHeaders } from "@nocturne/auth";
import { validateGeneratedContent } from "@nocturne/content-engine";
import {
  createDatabase,
  createInventionStore,
  createPersistentWorldStore,
  InventionStoreError,
  PersistentWorldError,
} from "@nocturne/database";
import Fastify from "fastify";
import { ZodError } from "zod";
import { createInventionService } from "./invention-service.js";
import { createPersistentWorldService } from "./persistent-world.js";

export async function buildApp() {
  getAuthFromEnv();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const database = createDatabase(databaseUrl);
  const world = createPersistentWorldService(createPersistentWorldStore(database));
  const inventions = createInventionService(createInventionStore(database));
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL || "info" } });
  await app.register(cors, {
    origin: (process.env.BETTER_AUTH_TRUSTED_ORIGINS || "http://localhost:3000")
      .split(",")
      .map((origin) => origin.trim()),
    credentials: true,
  });

  async function requireUser(headers: Record<string, string | string[] | undefined>) {
    const session = await getSessionFromNodeHeaders(headers);
    if (!session) throw new PersistentWorldError("forbidden", "Authentication is required.");
    return session.user;
  }
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({ error: "invalid_request", issues: error.issues });
    if (error instanceof PersistentWorldError || error instanceof InventionStoreError) {
      const status =
        error.code === "not_found"
          ? 404
          : error.code === "forbidden"
            ? 403
            : error.code === "installation_failed" || error.code === "residence_unavailable"
              ? 409
              : 422;
      return reply.code(status).send({ error: error.code, message: error.message });
    }
    const providerCode =
      error instanceof Error && "code" in error ? String((error as { code: unknown }).code) : null;
    if (providerCode)
      return reply.code(providerCode === "configuration" ? 503 : 502).send({
        error: providerCode,
        message: error instanceof Error ? error.message : String(error),
      });
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
    authoritative: createModelPolicy({
      task: "parse_intent",
      authoritativeModel: process.env.NOCTURNE_AUTHORITATIVE_MODEL,
    }),
    creative: createModelPolicy({
      task: "narrate_event",
      creativeModel: process.env.NOCTURNE_CREATIVE_MODEL,
    }),
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

  app.addHook("onClose", async () => {
    await Promise.all([closeAuthFromEnv(), database.close()]);
  });
  return app;
}
