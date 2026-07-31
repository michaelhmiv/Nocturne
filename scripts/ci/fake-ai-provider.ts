import { appendFile, mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

const port = Number(process.env.FAKE_AI_PORT || 4010);
const transcriptPath = process.env.FAKE_AI_TRANSCRIPT || "artifacts/fake-ai-provider.ndjson";

await mkdir(dirname(transcriptPath), { recursive: true });

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

function after(text: string, marker: string, until?: string) {
  const start = text.indexOf(marker);
  if (start < 0) return "";
  const remainder = text.slice(start + marker.length);
  if (!until) return remainder.trim();
  const end = remainder.indexOf(until);
  return (end < 0 ? remainder : remainder.slice(0, end)).trim();
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

function classifyAction(command: string) {
  const text = command.toLowerCase();
  if (/\b(lockpick|pick the .*lock|locked cabinet)\b/.test(text)) return "lockpick";
  if (/\b(arrest|restrain .*custody)\b/.test(text)) return "arrest";
  if (/\b(disguise|blend into|change my appearance)\b/.test(text)) return "disguise";
  if (/\b(forge|counterfeit|copy of the access card)\b/.test(text)) return "forge";
  if (/\b(bribe|offer .*money|pay .*look the other way)\b/.test(text)) return "bribe";
  if (/\b(persuade|convince)\b/.test(text)) return "persuade";
  if (/\b(threaten|warn .*expose)\b/.test(text)) return "threaten";
  if (/\b(steal|pickpocket|slip .*pocket)\b/.test(text)) return "steal";
  if (/\b(sneak|quietly through|silently)\b/.test(text)) return "sneak";
  if (/\b(hack|bypass .*network|security terminal)\b/.test(text)) return "hack";
  if (/\b(bandage|heal|treat .*injury|first-aid)\b/.test(text)) return "heal";
  if (/\b(eat|drink|consume|swallow|ingest|sandwich|glass of water)\b/.test(text)) return "consume";
  if (/\b(craft|build .*workshop|make .*materials)\b/.test(text)) return "craft";
  if (/\b(drive|take the car|vehicle)\b/.test(text)) return "drive";
  if (/\b(plant|tracker under|evidence in .*bag)\b/.test(text)) return "plant";
  if (/\b(observe|watch .*routine|take in my surroundings|look around the room)\b/.test(text))
    return "observe";
  if (/\b(buy|purchase)\b/.test(text)) return "buy";
  if (/\b(sell|list .*for sale)\b/.test(text)) return "sell";
  if (/\b(hide|concealed position|behind the crates)\b/.test(text)) return "hide";
  if (/\b(work|shift|delivery job|available job)\b/.test(text)) return "work";
  if (/\b(attack|punch|strike|hit|fight)\b/.test(text)) return "attack";
  if (/\b(talk|ask|conversation|bartender)\b/.test(text)) return "talk";
  if (/\b(detect|scan|check .*watching|hidden threats)\b/.test(text)) return "detect";
  if (/\b(search|look through|look for|scan .*for)\b/.test(text)) return "search";
  if (/\b(walk|move|head toward|go to|travel)\b/.test(text)) return "move";
  return "detect";
}

function worldKind(actionType: string) {
  if (["detect", "search", "observe"].includes(actionType)) return "search";
  if (["move", "drive"].includes(actionType)) return "move";
  if (actionType === "consume") return "consume";
  if (["bribe", "persuade", "threaten"].includes(actionType)) return "relationship";
  if (["attack", "arrest"].includes(actionType)) return "combat";
  if (["steal", "buy", "sell"].includes(actionType)) return "transfer";
  if (actionType === "talk") return "dialogue";
  return "interact";
}

function locationFromFacts(facts: unknown, actorId: string) {
  if (Array.isArray(facts)) {
    const actorLocation = facts.find(
      (fact) =>
        fact &&
        typeof fact === "object" &&
        (fact as Record<string, unknown>).entityId === actorId &&
        (fact as Record<string, unknown>).claim === "entity.location" &&
        typeof (fact as Record<string, unknown>).value === "string",
    ) as Record<string, unknown> | undefined;
    if (actorLocation) return String(actorLocation.value);
    const anyLocation = facts.find(
      (fact) =>
        fact &&
        typeof fact === "object" &&
        (fact as Record<string, unknown>).claim === "entity.location" &&
        typeof (fact as Record<string, unknown>).value === "string",
    ) as Record<string, unknown> | undefined;
    if (anyLocation) return String(anyLocation.value);
  }
  const match = JSON.stringify(facts).match(UUID);
  return match?.[0] || actorId;
}

function referenceResponse() {
  return { mentions: [] };
}

function plannerResponse(prompt: string) {
  const command = after(prompt, "COMMAND:\n", "\n\nACTOR ID:");
  const actorId = after(prompt, "ACTOR ID:\n", "\n\nRESOLVED ENTITY IDS:").match(UUID)?.[0];
  if (!actorId) throw new Error("Planner fixture could not find actor ID.");
  const factsText = after(prompt, "PLAYER-KNOWN FACTS:\n", "\n\nACTIVE PLAN:");
  const facts = parseJson<unknown[]>(factsText, []);
  const locationId = locationFromFacts(facts, actorId);
  const actionType = classifyAction(command);
  const kind = worldKind(actionType);
  const intentPayload: Record<string, unknown> = { rawText: command, actionType };
  if (kind === "search") {
    intentPayload.areaId = locationId;
    intentPayload.requestedConcept = /dog/i.test(command) ? "dog" : "evidence";
  }
  if (kind === "move") intentPayload.destinationId = locationId;
  return {
    primaryKind: kind,
    requiresClarification: false,
    rationale: `Deterministic certification route for ${actionType}.`,
    plan: {
      originalCommand: command,
      exclusivePhysical: !["dialogue", "question"].includes(kind),
      steps: [
        {
          order: 1,
          kind,
          description: command,
          intentPayload,
          referencedEntities: [{ entityId: actorId, role: "actor", referenceText: "you" }],
        },
      ],
      dependencies: [],
    },
  };
}

function actionIntentResponse(prompt: string) {
  const command = after(prompt, "PLAYER ACTION:\n", "\n\nPUBLIC CONTEXT:");
  const context = parseJson<Record<string, any>>(after(prompt, "PUBLIC CONTEXT:\n"), {});
  const actionType = classifyAction(command);
  const actorId = context.actor?.id || JSON.stringify(context).match(UUID)?.[0];
  const targetId = context.targetLocation?.id || actorId;
  const methodDefinitionId = context.method?.definitionId;
  if (!actorId) throw new Error("Intent fixture could not find actor ID.");
  return {
    intent: {
      actorId,
      rawText: command,
      actionType,
      targetIds: targetId ? [targetId] : [],
      methodDefinitionIds: methodDefinitionId ? [methodDefinitionId] : [],
      objective: command.slice(0, 120),
      intensity: /careful|quiet|slow/i.test(command) ? "careful" : "normal",
      assumptions: [],
      confidence: 1,
    },
    proposedModifiers: [],
    relevantContextFacts: [],
  };
}

function consumableResponse(prompt: string) {
  const rawText = after(prompt, "PLAYER REQUEST:\n", "\n\nLOCATION:");
  const candidates = parseJson<any[]>(after(prompt, "AUTHORITATIVE CANDIDATES:\n"), []);
  const candidate = candidates.find((value) => Number(value?.quantity ?? 1) > 0);
  if (!candidate) {
    return {
      selection: {
        sourceType: "none",
        displayName: "No accessible matching substance",
        rationale: "No supplied candidate can satisfy the request.",
        confidence: 1,
      },
      classification: {
        consumable: false,
        substanceKind: "unavailable",
        portionDescription: "none",
        freshnessAssessment: "not applicable",
        confidence: 1,
      },
      requestedUnits: 1,
      consumeUnits: 0,
      resourceDeltas: [],
      conditions: [],
      risks: [],
      narrationFacts: ["No units were consumed."],
      assumptions: [],
    };
  }
  const displayName = String(
    candidate.name || (/water/i.test(rawText) ? "water" : "ordinary food"),
  );
  return {
    selection: {
      sourceType: candidate.sourceType,
      sourceId: candidate.sourceId,
      displayName,
      rationale: "The supplied authoritative candidate matches the ordinary request.",
      confidence: 1,
    },
    classification: {
      consumable: true,
      substanceKind: /water|drink/i.test(rawText) ? "nonalcoholic_drink" : "ordinary_food",
      portionDescription: "one ordinary serving",
      freshnessAssessment: "ordinary and usable",
      confidence: 1,
    },
    requestedUnits: 1,
    consumeUnits: 1,
    ...(candidate.sourceType === "ambient_pool"
      ? {
          materialization: {
            name: displayName,
            conceptSummary: `One ordinary serving of ${displayName}.`,
            descriptiveTraits: ["ordinary", "household"],
            unitsCreated: 1,
          },
        }
      : {}),
    resourceDeltas: [
      {
        resource: /water|drink/i.test(rawText) ? "hydration" : "satiety",
        delta: 5,
        rationale: "One ordinary serving provides a modest benefit.",
      },
    ],
    conditions: [],
    risks: [],
    narrationFacts: [`One unit of ${displayName} is consumed.`],
    assumptions: ["The ordinary serving has no unusual hidden effects."],
  };
}

function searchResponse(prompt: string) {
  const requestedConcept = after(prompt, "REQUESTED CONCEPT:\n", "\n\nACTOR FACTS:") || "evidence";
  return {
    targetFamily: /dog|animal/i.test(requestedConcept) ? "animal" : "evidence",
    requestedConcept,
    mayMaterialize: false,
    actorScore: 2,
    targetScore: 2,
    modifiers: [],
    successDescription: `You find credible signs related to ${requestedConcept}.`,
    consequenceDescription: `You find signs of ${requestedConcept}, but draw attention.`,
    partialDescription: `You find incomplete evidence related to ${requestedConcept}.`,
    progressDescription: `You do not find it, but identify a useful lead.`,
    failureDescription: `The search produces no reliable evidence of ${requestedConcept}.`,
    reversalDescription: `The search exposes you to a new complication.`,
    assumptions: ["No concrete entity is asserted unless separately selected."],
  };
}

function responseFor(schemaName: string, prompt: string) {
  switch (schemaName) {
    case "nocturne_entity_reference_interpretation":
      return referenceResponse();
    case "nocturne_persistent_world_action_plan":
      return plannerResponse(prompt);
    case "nocturne_action_intent":
      return actionIntentResponse(prompt);
    case "nocturne_consumable_analysis":
      return consumableResponse(prompt);
    case "nocturne_event_narration":
      return {
        narration:
          "You carry out the committed action, and the world reflects only what actually occurred.",
      };
    case "nocturne_search_discovery_analysis":
      return searchResponse(prompt);
    case "nocturne_provider_contract":
      return {
        status: "ok",
        capability: /creative-json/.test(prompt) ? "creative-json" : "authoritative-json",
      };
    default:
      throw new Error(`No deterministic fixture exists for schema ${schemaName}.`);
  }
}

async function record(entry: Record<string, unknown>) {
  await appendFile(
    transcriptPath,
    `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`,
  );
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", service: "fake-ai-provider" }));
    return;
  }
  if (request.method !== "POST" || !request.url?.endsWith("/chat/completions")) {
    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "not found" } }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const bodyText = Buffer.concat(chunks).toString("utf8");
  const body = parseJson<Record<string, any>>(bodyText, {});
  const system = String(body.messages?.[0]?.content || "");
  const prompt = String(body.messages?.[1]?.content || "");
  const schemaName = /JSON schema name:\s*([^\n]+)/.exec(system)?.[1]?.trim() || "unknown";
  const requestId = `fake-${randomUUID()}`;
  await record({ requestId, schemaName, model: body.model, prompt, requestBody: body });

  if (prompt.includes("[fake:timeout]")) {
    await new Promise((resolve) => setTimeout(resolve, 120_000));
    return;
  }
  if (prompt.includes("[fake:429]")) {
    response.writeHead(429, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "deterministic rate limit" } }));
    return;
  }
  if (prompt.includes("[fake:500]")) {
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "deterministic provider failure" } }));
    return;
  }
  if (prompt.includes("[fake:empty]")) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: requestId,
        model: body.model,
        choices: [{ finish_reason: "stop", message: { content: "" } }],
      }),
    );
    return;
  }
  if (prompt.includes("[fake:invalid-json]")) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: requestId,
        model: body.model,
        choices: [{ finish_reason: "stop", message: { content: "not-json" } }],
      }),
    );
    return;
  }

  try {
    const content = responseFor(schemaName, prompt);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: requestId,
        model: body.model || "nocturne-fake",
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }],
      }),
    );
    await record({ requestId, schemaName, response: content });
  } catch (error) {
    await record({
      requestId,
      schemaName,
      error: error instanceof Error ? error.message : String(error),
    });
    response.writeHead(422, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        error: { message: error instanceof Error ? error.message : String(error) },
      }),
    );
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    JSON.stringify({ status: "ready", service: "fake-ai-provider", port, transcriptPath }),
  );
});

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
