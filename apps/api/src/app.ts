import cors from "@fastify/cors";
import { createModelPolicy } from "@nocturne/ai-gm";
import { getAuthFromEnv } from "@nocturne/auth";
import { validateGeneratedContent } from "@nocturne/content-engine";
import Fastify from "fastify";

function toHeaders(input: Record<string, string | string[] | undefined>): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(input)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
  });

  await app.register(cors, {
    origin: (process.env.BETTER_AUTH_TRUSTED_ORIGINS || "http://localhost:3000")
      .split(",")
      .map((origin) => origin.trim()),
    credentials: true,
  });

  app.get("/health", async () => ({
    status: "ok",
    service: "api",
    openRouterConfigured: Boolean(process.env.OPENROUTER_API_KEY),
  }));

  app.get("/v1/me", async (request, reply) => {
    const session = await getAuthFromEnv().api.getSession({
      headers: toHeaders(request.headers),
    });

    if (!session) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    return { user: session.user, session: session.session };
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
    if (result.status === "invalid") {
      return reply.code(422).send(result);
    }
    return result;
  });

  return app;
}
