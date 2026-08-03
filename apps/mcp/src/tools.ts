import { createHash, randomUUID } from "node:crypto";
import type { McpConfig } from "./config.js";

export type ToolScope = "nocturne.read" | "nocturne.write";

type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
  requiredScope: ToolScope;
  execute(input: unknown): Promise<unknown>;
};

type FetchLike = typeof fetch;
type JsonObject = Record<string, unknown>;

const emptySchema = { type: "object", properties: {}, additionalProperties: false };
const readAnnotations: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
const writeAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

function object(input: unknown): JsonObject {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Tool arguments must be an object.");
  }
  return input as JsonObject;
}

function requiredString(input: JsonObject, key: string, maxLength = 4000) {
  const value = input[key];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${key} is required.`);
  if (value.length > maxLength) throw new Error(`${key} must be ${maxLength} characters or fewer.`);
  return value.trim();
}

function optionalString(input: JsonObject, key: string) {
  const value = input[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be a string.`);
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalInteger(
  input: JsonObject,
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const value = input[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function optionalNumber(
  input: JsonObject,
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const value = input[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${key} must be a number from ${min} to ${max}.`);
  }
  return value;
}

export class NocturneApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: unknown,
    message: string,
  ) {
    super(message);
    this.name = "NocturneApiError";
  }
}

export class NocturneApiClient {
  constructor(
    private readonly config: McpConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("user-agent", "nocturne-mcp/0.1.0");
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (this.config.apiAuthMode === "guest") {
      headers.set("x-nocturne-guest-mode", "1");
    } else if (this.config.apiBearerToken) {
      headers.set("authorization", `Bearer ${this.config.apiBearerToken}`);
    }
    const response = await this.fetchImpl(`${this.config.apiBaseUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!response.ok) {
      const detail =
        payload && typeof payload === "object" && "message" in payload
          ? String((payload as { message: unknown }).message)
          : text || response.statusText;
      throw new NocturneApiError(response.status, payload, `${response.status} ${detail}`);
    }
    return payload;
  }
}

function fingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function readTool(
  name: string,
  title: string,
  description: string,
  inputSchema: Record<string, unknown>,
  execute: McpTool["execute"],
): McpTool {
  return {
    name,
    title,
    description,
    inputSchema,
    annotations: readAnnotations,
    requiredScope: "nocturne.read",
    execute,
  };
}

function writeTool(
  name: string,
  title: string,
  description: string,
  inputSchema: Record<string, unknown>,
  execute: McpTool["execute"],
): McpTool {
  return {
    name,
    title,
    description,
    inputSchema,
    annotations: writeAnnotations,
    requiredScope: "nocturne.write",
    execute,
  };
}

export function createNocturneTools(config: McpConfig, fetchImpl: FetchLike = fetch): McpTool[] {
  const api = new NocturneApiClient(config, fetchImpl);
  return [
    readTool(
      "nocturne_health",
      "Check Nocturne health",
      "Check the Nocturne API, worker, queue, provider, deployment, and MCP connection before running gameplay tests.",
      emptySchema,
      async () => {
        const [apiHealth, operationalHealth] = await Promise.all([
          api.request("/health"),
          api.request("/v1/system/operational-health"),
        ]);
        return {
          mcp: { status: "ok", service: "nocturne-mcp" },
          api: apiHealth,
          operational: operationalHealth,
        };
      },
    ),
    readTool(
      "get_world_start",
      "Read starter world",
      "Read the player-visible starter world and residence information.",
      emptySchema,
      async () => api.request("/v1/world/start"),
    ),
    readTool(
      "list_characters",
      "List Nocturne characters",
      "List characters for the configured Nocturne account and identify the selected character.",
      emptySchema,
      async () => api.request("/v1/characters"),
    ),
    writeTool(
      "create_character",
      "Create test character",
      "Create a character through the same public API used by the game client.",
      {
        type: "object",
        properties: {
          name: { type: "string", minLength: 1, maxLength: 80 },
          conceptSummary: { type: "string", minLength: 1, maxLength: 1000 },
          idempotencyKey: { type: "string", minLength: 1, maxLength: 256 },
        },
        required: ["name", "conceptSummary"],
        additionalProperties: false,
      },
      async (raw) => {
        const input = object(raw);
        return api.request("/v1/characters", {
          method: "POST",
          headers: {
            "idempotency-key":
              optionalString(input, "idempotencyKey") || `mcp-character-${randomUUID()}`,
          },
          body: JSON.stringify({
            name: requiredString(input, "name", 80),
            conceptSummary: requiredString(input, "conceptSummary", 1000),
            originSource: "mcp_test",
          }),
        });
      },
    ),
    writeTool(
      "select_character",
      "Select character",
      "Select the active character for subsequent natural-language actions.",
      {
        type: "object",
        properties: { characterId: { type: "string", format: "uuid" } },
        required: ["characterId"],
        additionalProperties: false,
      },
      async (raw) => {
        const characterId = requiredString(object(raw), "characterId", 100);
        return api.request(`/v1/characters/${encodeURIComponent(characterId)}/select`, {
          method: "POST",
          body: "{}",
        });
      },
    ),
    writeTool(
      "rent_starter_residence",
      "Rent starter residence",
      "Rent the starter residence for a character through the normal gameplay API.",
      {
        type: "object",
        properties: {
          characterId: { type: "string", format: "uuid" },
          idempotencyKey: { type: "string", minLength: 1, maxLength: 256 },
        },
        required: ["characterId"],
        additionalProperties: false,
      },
      async (raw) => {
        const input = object(raw);
        return api.request("/v1/residences/starter/rent", {
          method: "POST",
          headers: {
            "idempotency-key":
              optionalString(input, "idempotencyKey") || `mcp-residence-${randomUUID()}`,
          },
          body: JSON.stringify({ characterId: requiredString(input, "characterId", 100) }),
        });
      },
    ),
    readTool(
      "get_scene",
      "Read current scene",
      "Read the authoritative player-visible scene for the selected character.",
      emptySchema,
      async () => api.request("/v1/persistent-world/scene"),
    ),
    readTool(
      "get_dashboard",
      "Read player dashboard",
      "Read current location, state, effects, history, plans, and other player-visible projections.",
      {
        type: "object",
        properties: { historyLimit: { type: "integer", minimum: 1, maximum: 200, default: 100 } },
        additionalProperties: false,
      },
      async (raw) => {
        const limit = optionalInteger(object(raw), "historyLimit", 100, 1, 200);
        const dashboard = await api.request(`/v1/persistent-world/dashboard?historyLimit=${limit}`);
        return { fingerprint: fingerprint(dashboard), dashboard };
      },
    ),
    readTool(
      "wait_for_dashboard_change",
      "Wait for world state change",
      "Poll the dashboard until it differs from a prior fingerprint. Use this for real-time travel and scheduled actions.",
      {
        type: "object",
        properties: {
          previousFingerprint: { type: "string", minLength: 64, maxLength: 64 },
          timeoutSeconds: { type: "integer", minimum: 1, maximum: 60, default: 30 },
          historyLimit: { type: "integer", minimum: 1, maximum: 200, default: 100 },
        },
        required: ["previousFingerprint"],
        additionalProperties: false,
      },
      async (raw) => {
        const input = object(raw);
        const previous = requiredString(input, "previousFingerprint", 64);
        const timeoutSeconds = optionalInteger(input, "timeoutSeconds", 30, 1, 60);
        const historyLimit = optionalInteger(input, "historyLimit", 100, 1, 200);
        const deadline = Date.now() + timeoutSeconds * 1000;
        do {
          const dashboard = await api.request(
            `/v1/persistent-world/dashboard?historyLimit=${historyLimit}`,
          );
          const current = fingerprint(dashboard);
          if (current !== previous) return { changed: true, fingerprint: current, dashboard };
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } while (Date.now() < deadline);
        const dashboard = await api.request(
          `/v1/persistent-world/dashboard?historyLimit=${historyLimit}`,
        );
        return { changed: false, fingerprint: fingerprint(dashboard), dashboard };
      },
    ),
    writeTool(
      "submit_action",
      "Submit natural-language action",
      "Submit one natural-language player action to the persistent-world runtime. Do not pre-classify it or provide destination, target, or handler IDs; this tool tests the LLM interpretation and authoritative execution pipeline.",
      {
        type: "object",
        properties: {
          text: { type: "string", minLength: 1, maxLength: 4000 },
          actorId: { type: "string", format: "uuid" },
          idempotencyKey: { type: "string", minLength: 1, maxLength: 256 },
          traceId: { type: "string", minLength: 1, maxLength: 256 },
        },
        required: ["text"],
        additionalProperties: false,
      },
      async (raw) => {
        const input = object(raw);
        const actorId = optionalString(input, "actorId");
        return api.request("/v1/persistent-world/actions", {
          method: "POST",
          headers: {
            "idempotency-key":
              optionalString(input, "idempotencyKey") || `mcp-action-${randomUUID()}`,
            "x-nocturne-trace-id": optionalString(input, "traceId") || `mcp-${randomUUID()}`,
          },
          body: JSON.stringify({
            ...(actorId ? { actorId } : {}),
            command: requiredString(input, "text", 4000),
          }),
        });
      },
    ),
    readTool(
      "list_actions",
      "List committed actions",
      "List committed action-history records for a character and compare narration with persisted outcomes.",
      {
        type: "object",
        properties: { actorId: { type: "string", format: "uuid" } },
        required: ["actorId"],
        additionalProperties: false,
      },
      async (raw) =>
        api.request(
          `/v1/actions?actorId=${encodeURIComponent(requiredString(object(raw), "actorId", 100))}`,
        ),
    ),
    readTool(
      "list_vehicles",
      "List vehicles",
      "List available or owned vehicles and their current backend state.",
      {
        type: "object",
        properties: { ownerId: { type: "string", format: "uuid" } },
        additionalProperties: false,
      },
      async (raw) => {
        const ownerId = optionalString(object(raw), "ownerId");
        return api.request(
          `/v1/vehicles${ownerId ? `?ownerId=${encodeURIComponent(ownerId)}` : ""}`,
        );
      },
    ),
    readTool(
      "get_travel_path",
      "Inspect travel path",
      "Ask the deterministic route engine for a path and duration between authoritative location UUIDs.",
      {
        type: "object",
        properties: {
          fromLocationId: { type: "string", format: "uuid" },
          toLocationId: { type: "string", format: "uuid" },
          speedFactor: { type: "number", exclusiveMinimum: 0, maximum: 100, default: 1 },
        },
        required: ["fromLocationId", "toLocationId"],
        additionalProperties: false,
      },
      async (raw) => {
        const input = object(raw);
        const from = requiredString(input, "fromLocationId", 100);
        const to = requiredString(input, "toLocationId", 100);
        const speedFactor = optionalNumber(input, "speedFactor", 1, 0.01, 100);
        return api.request(
          `/v1/travel/path?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&speedFactor=${speedFactor}`,
        );
      },
    ),
    readTool(
      "get_operator_dashboard",
      "Read operator trace dashboard",
      "Read the operator projection for actions, plans, steps, schedules, events, and mutations for a test actor.",
      {
        type: "object",
        properties: {
          actorId: { type: "string", format: "uuid" },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
        },
        required: ["actorId"],
        additionalProperties: false,
      },
      async (raw) => {
        const input = object(raw);
        const actorId = requiredString(input, "actorId", 100);
        const limit = optionalInteger(input, "limit", 50, 1, 100);
        return api.request(
          `/v1/operator/world/dashboard/${encodeURIComponent(actorId)}?limit=${limit}`,
        );
      },
    ),
    readTool(
      "inspect_world_entity",
      "Inspect world entity",
      "Inspect one authoritative entity, its relationships, state, history, and active plan references.",
      {
        type: "object",
        properties: { entityId: { type: "string", format: "uuid" } },
        required: ["entityId"],
        additionalProperties: false,
      },
      async (raw) =>
        api.request(
          `/v1/operator/world/entities/${encodeURIComponent(requiredString(object(raw), "entityId", 100))}`,
        ),
    ),
  ];
}
