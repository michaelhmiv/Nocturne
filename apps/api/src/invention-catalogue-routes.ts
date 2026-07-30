import type { FastifyInstance } from "fastify";
import {
  INVENTION_CAPACITY_RULES,
  INVENTION_EFFECT_CATALOGUE,
  INVENTION_MECHANICS_VERSION,
} from "@nocturne/content-engine";

export async function registerInventionCatalogueRoutes(app: FastifyInstance) {
  app.get("/v1/system/invention-catalogue", async () => ({
    version: INVENTION_MECHANICS_VERSION,
    effects: INVENTION_EFFECT_CATALOGUE,
    installationCapacities: INVENTION_CAPACITY_RULES,
    principle:
      "AI preserves the player's fantasy and proposes tradeoffs; canonical mechanics keep the result compatible with the authoritative rules engine.",
  }));
}
