import type { FastifyInstance } from "fastify";
import { getSessionFromNodeHeaders } from "@nocturne/auth";
import { SceneProjectionSchema, type FactReference } from "@nocturne/contracts";
import {
  AuthoritativeContextError,
  createAgentStore,
  createAuthoritativeContextStore,
  createDatabase,
  createPersistentWorldStore,
  PersistentWorldError,
} from "@nocturne/database";
import { createPersistentWorldService } from "./persistent-world.js";

function factValue(facts: FactReference[], claim: string): string | number | boolean | null {
  const fact = facts.find((candidate) => candidate.claim === claim);
  return fact?.value ?? null;
}

function pairedEntities(
  facts: FactReference[],
  idClaim: "observed_entity" | "owned_entity",
  nameClaim: "observed_entity_name" | "owned_entity_name",
  relationship: "visible" | "owned",
) {
  const ids = facts
    .filter((fact) => fact.claim === idClaim && typeof fact.value === "string")
    .map((fact) => String(fact.value));
  const names = facts
    .filter((fact) => fact.claim === nameClaim && typeof fact.value === "string")
    .map((fact) => String(fact.value));
  return ids.map((instanceId, index) => ({
    instanceId,
    name: names[index] || "Unknown figure",
    relationship,
  }));
}

function atmosphere(locationName: string, visibleCount: number): string {
  const activity =
    visibleCount > 2
      ? "Voices and movement overlap nearby."
      : visibleCount > 0
        ? "Someone else is close enough to matter."
        : "Nothing obvious moves nearby, but the city never feels empty.";
  return `${locationName} sits under Calder City's low industrial glow. ${activity}`;
}

export async function registerSceneRoutesFromEnv(app: FastifyInstance) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for scene routes.");
  const database = createDatabase(databaseUrl);
  const agents = createAgentStore(database);
  const context = createAuthoritativeContextStore(database);
  const world = createPersistentWorldService(createPersistentWorldStore(database));

  async function requireUser(headers: Record<string, string | string[] | undefined>) {
    const authorization = headers.authorization;
    const bearer = Array.isArray(authorization) ? authorization[0] : authorization;
    const agent = await agents.authenticate(bearer);
    if (agent) return { id: agent.userId };
    if (process.env.NOCTURNE_GUEST_MODE === "true" && headers["x-nocturne-guest-mode"] === "1") {
      return { id: process.env.NOCTURNE_GUEST_USER_ID || "nocturne-test-guest" };
    }
    const session = await getSessionFromNodeHeaders(headers);
    if (!session) throw new PersistentWorldError("forbidden", "Authentication is required.");
    return session.user;
  }

  app.get("/v1/scene", async (request) => {
    const user = await requireUser(request.headers);
    const [characters, starterWorld] = await Promise.all([
      world.listCharacters(user.id),
      world.getStarterWorld(),
    ]);
    const selected = characters.find((character) => character.selected) || characters[0] || null;

    if (!selected) {
      return SceneProjectionSchema.parse({
        character: null,
        location: {
          locationId: null,
          name: starterWorld.neighborhood.name,
          area: starterWorld.neighborhood.name,
          atmosphere: atmosphere(starterWorld.neighborhood.name, 0),
        },
        visibleEntities: [],
        ownedEntities: [],
        discoveries: [],
        opportunities: [
          {
            opportunityId: "create-character",
            label: "Enter Calder City",
            suggestedAction: "Create a character and choose who arrives in the city.",
          },
        ],
        generatedAt: new Date().toISOString(),
      });
    }

    let playerKnownFacts: FactReference[] = [];
    try {
      playerKnownFacts = (await context.buildContext(user.id)).playerKnownFacts;
    } catch (error) {
      if (!(error instanceof AuthoritativeContextError)) throw error;
    }

    const visibleEntities = pairedEntities(
      playerKnownFacts,
      "observed_entity",
      "observed_entity_name",
      "visible",
    );
    const ownedEntities = pairedEntities(
      playerKnownFacts,
      "owned_entity",
      "owned_entity_name",
      "owned",
    );
    const currentLocationId = factValue(playerKnownFacts, "current_location");
    const knownLocationName = factValue(playerKnownFacts, "current_location_name");
    const locationName =
      typeof knownLocationName === "string"
        ? knownLocationName
        : selected.residenceId
          ? starterWorld.residence.name
          : starterWorld.neighborhood.name;
    const discoveries = playerKnownFacts
      .filter((fact) => fact.claim === "held_information" && typeof fact.value === "string")
      .map((fact) => String(fact.value));
    const opportunities = [
      ...(!selected.residenceId
        ? [
            {
              opportunityId: "secure-base",
              label: "Secure a base",
              suggestedAction: "I take a closer look at the available apartment.",
            },
          ]
        : []),
      ...visibleEntities.slice(0, 3).flatMap((entity) => [
        {
          opportunityId: `approach:${entity.instanceId}`,
          label: `Approach ${entity.name}`,
          suggestedAction: `I approach ${entity.name} and start a conversation.`,
        },
        {
          opportunityId: `observe:${entity.instanceId}`,
          label: `Watch ${entity.name}`,
          suggestedAction: `I quietly observe ${entity.name} before doing anything else.`,
        },
      ]),
      ...ownedEntities.slice(0, 2).map((entity) => ({
        opportunityId: `use:${entity.instanceId}`,
        label: `Use ${entity.name}`,
        suggestedAction: `I use ${entity.name} to help with the situation here.`,
      })),
      {
        opportunityId: "search-area",
        label: "Search the area",
        suggestedAction: "I search the immediate area for anything unusual or useful.",
      },
      {
        opportunityId: "work-local-job",
        label: "Find work",
        suggestedAction: "I look for a paying job nearby.",
      },
    ].slice(0, 8);

    return SceneProjectionSchema.parse({
      character: {
        characterId: selected.characterId,
        name: selected.name,
        conceptSummary: selected.conceptSummary,
        cashOnPerson: selected.cashOnPerson ?? 0,
        heat: selected.heat ?? 0,
        warrant: selected.warrant ?? false,
        status: selected.status ?? "active",
      },
      location: {
        locationId: typeof currentLocationId === "string" ? currentLocationId : null,
        name: locationName,
        area: starterWorld.neighborhood.name,
        atmosphere: atmosphere(locationName, visibleEntities.length),
      },
      visibleEntities,
      ownedEntities,
      discoveries,
      opportunities,
      generatedAt: new Date().toISOString(),
    });
  });

  app.addHook("onClose", async () => database.close());
}
