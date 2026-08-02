import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { McpConfig } from "./config.js";
import { OAuthError, OAuthService, type AuthorizedPrincipal } from "./oauth.js";
import { createNocturneTools, NocturneApiError, type McpTool } from "./tools.js";

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
};

type FetchLike = typeof fetch;

type FailedAuthorization = {
  count: number;
  windowStartedAt: number;
  blockedUntil: number;
};

const serverInfo = { name: "nocturne-mcp", title: "Nocturne", version: "0.1.0" };
const supportedProtocolVersions = ["2025-06-18", "2025-03-26", "2024-11-05"];
const authorizationWindowMs = 10 * 60 * 1000;
const authorizationBlockMs = 15 * 60 * 1000;
const maximumAuthorizationFailures = 5;

function setSecurityHeaders(response: ServerResponse) {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("cache-control", "no-store");
  response.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader(
    "content-security-policy",
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
}

function json(response: ServerResponse, status: number, body: unknown) {
  setSecurityHeaders(response);
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function html(response: ServerResponse, status: number, body: string) {
  setSecurityHeaders(response);
  response.statusCode = status;
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(body);
}

function redirect(response: ServerResponse, location: string) {
  setSecurityHeaders(response);
  response.statusCode = 302;
  response.setHeader("location", location);
  response.end();
}

async function readBody(request: IncomingMessage, limit = 1_000_000) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const value = Buffer.from(chunk);
    total += value.length;
    if (total > limit) throw new Error("request_too_large");
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJson(request: IncomingMessage) {
  const raw = await readBody(request);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("invalid_json");
  }
}

async function readForm(request: IncomingMessage) {
  return new URLSearchParams(await readBody(request));
}

function rpcSuccess(id: JsonRpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string, data?: unknown) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function toolResult(value: unknown) {
  const structuredContent =
    value && typeof value === "object" && !Array.isArray(value) ? value : { value };
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent,
  };
}

function toolError(error: unknown) {
  const details =
    error instanceof NocturneApiError
      ? { error: error.message, status: error.status, upstream: error.payload }
      : { error: error instanceof Error ? error.message : String(error) };
  return {
    content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
    structuredContent: details,
    isError: true,
  };
}

function requestUrl(request: IncomingMessage, base: string) {
  return new URL(request.url || "/", base);
}

function bearerChallenge(config: McpConfig, response: ServerResponse, message: string) {
  response.setHeader(
    "www-authenticate",
    `Bearer resource_metadata="${config.publicBaseUrl}/.well-known/oauth-protected-resource/mcp"`,
  );
  json(response, 401, { error: "invalid_token", error_description: message });
}

function requireScope(principal: AuthorizedPrincipal, tool: McpTool) {
  if (!principal.scopes.has(tool.requiredScope)) {
    throw new OAuthError(
      "insufficient_scope",
      `Tool ${tool.name} requires ${tool.requiredScope}.`,
      403,
    );
  }
}

function clientAddress(request: IncomingMessage) {
  const forwarded = String(request.headers["x-forwarded-for"] || "")
    .split(",", 1)[0]
    ?.trim();
  return forwarded || request.socket.remoteAddress || "unknown";
}

export function createMcpServer(config: McpConfig, fetchImpl: FetchLike = fetch) {
  const oauth = new OAuthService(config);
  const tools = createNocturneTools(config, fetchImpl);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const failedAuthorizations = new Map<string, FailedAuthorization>();

  function assertAuthorizationAllowed(request: IncomingMessage) {
    const key = clientAddress(request);
    const attempt = failedAuthorizations.get(key);
    if (attempt && attempt.blockedUntil > Date.now()) {
      throw new OAuthError(
        "temporarily_unavailable",
        "Too many failed authorization attempts. Try again later.",
        429,
      );
    }
  }

  function recordAuthorizationResult(request: IncomingMessage, approved: boolean) {
    const key = clientAddress(request);
    if (approved) {
      failedAuthorizations.delete(key);
      return;
    }
    const now = Date.now();
    const previous = failedAuthorizations.get(key);
    const active = previous && now - previous.windowStartedAt < authorizationWindowMs;
    const count = active ? previous.count + 1 : 1;
    failedAuthorizations.set(key, {
      count,
      windowStartedAt: active ? previous.windowStartedAt : now,
      blockedUntil: count >= maximumAuthorizationFailures ? now + authorizationBlockMs : 0,
    });
    if (failedAuthorizations.size > 10_000) failedAuthorizations.clear();
  }

  async function handleRpc(request: JsonRpcRequest, principal: AuthorizedPrincipal) {
    if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") {
      return rpcError(request?.id, -32600, "Invalid JSON-RPC request.");
    }
    if (request.method === "initialize") {
      const params =
        request.params && typeof request.params === "object"
          ? (request.params as Record<string, unknown>)
          : {};
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      const protocolVersion = supportedProtocolVersions.includes(requested)
        ? requested
        : supportedProtocolVersions[0];
      return rpcSuccess(request.id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo,
        instructions:
          "Use Nocturne tools to test the game through its public APIs. Submit player intent only through submit_action as natural language. After each write, inspect the scene, dashboard, and operator traces to verify durable state.",
      });
    }
    if (request.method === "ping") return rpcSuccess(request.id, {});
    if (
      request.method === "notifications/initialized" ||
      request.method === "notifications/cancelled"
    ) {
      return null;
    }
    if (request.method === "tools/list") {
      const visible = tools.filter((tool) => principal.scopes.has(tool.requiredScope));
      return rpcSuccess(request.id, {
        tools: visible.map(({ requiredScope: _requiredScope, execute: _execute, ...tool }) => tool),
      });
    }
    if (request.method === "tools/call") {
      const params =
        request.params && typeof request.params === "object"
          ? (request.params as Record<string, unknown>)
          : {};
      const name = typeof params.name === "string" ? params.name : "";
      const tool = byName.get(name);
      if (!tool) return rpcError(request.id, -32602, `Unknown tool: ${name || "(missing)"}`);
      try {
        requireScope(principal, tool);
        return rpcSuccess(request.id, toolResult(await tool.execute(params.arguments)));
      } catch (error) {
        return rpcSuccess(request.id, toolError(error));
      }
    }
    if (request.method === "resources/list") return rpcSuccess(request.id, { resources: [] });
    if (request.method === "prompts/list") return rpcSuccess(request.id, { prompts: [] });
    return rpcError(request.id, -32601, `Method not found: ${request.method}`);
  }

  return createServer(async (request, response) => {
    try {
      const url = requestUrl(request, config.publicBaseUrl);
      const method = request.method || "GET";
      if (method === "GET" && url.pathname === "/health") {
        return json(response, 200, {
          status: "ok",
          service: "nocturne-mcp",
          oauth: "configured",
          apiBaseUrl: config.apiBaseUrl,
          toolCount: tools.length,
        });
      }
      if (
        method === "GET" &&
        (url.pathname === "/.well-known/oauth-authorization-server" ||
          url.pathname === "/.well-known/openid-configuration")
      ) {
        return json(response, 200, oauth.authorizationMetadata());
      }
      if (
        method === "GET" &&
        (url.pathname === "/.well-known/oauth-protected-resource" ||
          url.pathname === "/.well-known/oauth-protected-resource/mcp")
      ) {
        return json(response, 200, oauth.protectedResourceMetadata());
      }
      if (method === "POST" && url.pathname === "/oauth/register") {
        return json(response, 201, oauth.registerClient(await readJson(request)));
      }
      if (method === "GET" && url.pathname === "/oauth/authorize") {
        assertAuthorizationAllowed(request);
        return html(response, 200, oauth.renderAuthorizationPage(url.searchParams));
      }
      if (method === "POST" && url.pathname === "/oauth/authorize") {
        assertAuthorizationAllowed(request);
        const result = oauth.approveAuthorization(await readForm(request));
        recordAuthorizationResult(request, result.ok);
        return result.ok ? redirect(response, result.redirect) : html(response, 401, result.html);
      }
      if (method === "POST" && url.pathname === "/oauth/token") {
        return json(response, 200, oauth.exchangeToken(await readForm(request)));
      }
      if (url.pathname === "/mcp" && method === "GET") {
        response.setHeader("allow", "POST, DELETE");
        return json(response, 405, {
          error: "method_not_allowed",
          message: "Use POST for MCP JSON-RPC.",
        });
      }
      if (url.pathname === "/mcp" && method === "DELETE") {
        response.statusCode = 204;
        return response.end();
      }
      if (url.pathname === "/mcp" && method === "POST") {
        let principal: AuthorizedPrincipal;
        try {
          principal = oauth.authorizeBearer(request.headers.authorization);
        } catch (error) {
          return bearerChallenge(
            config,
            response,
            error instanceof Error ? error.message : "Authorization failed.",
          );
        }
        const raw = await readJson(request);
        if (Array.isArray(raw)) {
          return json(
            response,
            400,
            rpcError(null, -32600, "JSON-RPC batching is not supported by MCP 2025-06-18."),
          );
        }
        const result = await handleRpc(raw as JsonRpcRequest, principal);
        if (result === null) {
          response.statusCode = 202;
          return response.end();
        }
        const accept = String(request.headers.accept || "application/json");
        if (accept.includes("text/event-stream") && !accept.includes("application/json")) {
          setSecurityHeaders(response);
          response.statusCode = 200;
          response.setHeader("content-type", "text/event-stream; charset=utf-8");
          return response.end(`event: message\ndata: ${JSON.stringify(result)}\n\n`);
        }
        return json(response, 200, result);
      }
      return json(response, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof OAuthError) {
        return json(response, error.status, {
          error: error.code,
          error_description: error.message,
        });
      }
      if (error instanceof Error && error.message === "invalid_json") {
        return json(response, 400, { error: "invalid_json" });
      }
      if (error instanceof Error && error.message === "request_too_large") {
        return json(response, 413, { error: "request_too_large" });
      }
      console.error(error);
      return json(response, 500, { error: "internal_error" });
    }
  });
}
