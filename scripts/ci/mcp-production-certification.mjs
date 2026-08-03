import { createHash, randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const webBaseUrl = (
  process.env.NOCTURNE_WEB_URL || "https://nocturneweb-production.up.railway.app"
).replace(/\/$/, "");
const mcpBaseUrl = (
  process.env.NOCTURNE_MCP_URL || "https://nocturnemcp-production.up.railway.app"
).replace(/\/$/, "");
const webOrigin = new URL(webBaseUrl).origin;
const redirectUri = "http://127.0.0.1/nocturne-certification-callback";
const runId = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const email = `mcp-cert-${runId}@example.invalid`;
const password = `Mcp-Cert-${randomBytes(18).toString("base64url")}!9a`;
const characterName = `MCP Certification ${runId.slice(-8)}`;
const cookies = new Map();

function cookieHeader(origin) {
  const values = cookies.get(origin);
  return values ? [...values.values()].join("; ") : undefined;
}

function rememberCookies(origin, response) {
  const values = cookies.get(origin) || new Map();
  const setCookies = response.headers.getSetCookie?.() || [];
  for (const raw of setCookies) {
    const first = raw.split(";", 1)[0];
    const separator = first.indexOf("=");
    if (separator > 0) values.set(first.slice(0, separator), first);
  }
  if (values.size) cookies.set(origin, values);
}

async function request(url, options = {}) {
  const parsed = new URL(url);
  const headers = new Headers(options.headers || {});
  const cookie = cookieHeader(parsed.origin);
  if (cookie) headers.set("cookie", cookie);
  if (parsed.origin === webOrigin && !headers.has("origin")) {
    headers.set("origin", webOrigin);
  }
  const response = await fetch(parsed, {
    ...options,
    headers,
    redirect: options.redirect || "manual",
  });
  rememberCookies(parsed.origin, response);
  return response;
}

async function json(response, label) {
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`${label} returned non-JSON (${response.status}): ${text.slice(0, 500)}`);
  }
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

function requiredLocation(response, label) {
  const location = response.headers.get("location");
  assert.ok(location, `${label} must return a redirect location`);
  return new URL(location, response.url).toString();
}

async function createAccountAndCharacter() {
  const signup = await request(`${webBaseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Nocturne MCP Certification",
      email,
      password,
    }),
  });
  await json(signup, "Better Auth sign-up");

  const character = await request(`${webBaseUrl}/api/game/characters`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: characterName,
      conceptSummary:
        "A disposable certification character used only for safe MCP action and persistence tests.",
    }),
  });
  const created = await json(character, "character onboarding");
  assert.ok(
    created.character?.id || created.id || created.characterId,
    `character onboarding did not return an identifier: ${JSON.stringify(created)}`,
  );
}

function pkce() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function authorize() {
  const registration = await request(`${mcpBaseUrl}/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: `Nocturne production certification ${runId}`,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const client = await json(registration, "OAuth client registration");
  assert.equal(typeof client.client_id, "string");

  const { verifier, challenge } = pkce();
  const state = randomUUID();
  const authorizeUrl = new URL(`${mcpBaseUrl}/oauth/authorize`);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", client.client_id);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "nocturne.read nocturne.write");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");

  const start = await request(authorizeUrl, { method: "GET" });
  assert.equal(start.status, 302, "MCP authorize must redirect to Nocturne account linking");
  const webAuthorizeUrl = requiredLocation(start, "MCP authorize");
  assert.equal(new URL(webAuthorizeUrl).origin, webOrigin);

  const linked = await request(webAuthorizeUrl, { method: "GET" });
  assert.equal(linked.status, 302, "Nocturne account linking must redirect to the MCP callback");
  const accountCallbackUrl = requiredLocation(linked, "Nocturne account linking");
  assert.equal(new URL(accountCallbackUrl).origin, new URL(mcpBaseUrl).origin);

  const callback = await request(accountCallbackUrl, { method: "GET" });
  assert.equal(callback.status, 302, "MCP account callback must issue an authorization code");
  const applicationRedirect = new URL(requiredLocation(callback, "MCP account callback"));
  assert.equal(applicationRedirect.origin + applicationRedirect.pathname, redirectUri);
  assert.equal(applicationRedirect.searchParams.get("state"), state);
  const code = applicationRedirect.searchParams.get("code");
  assert.ok(code, "authorization redirect must include a code");

  const tokenResponse = await request(`${mcpBaseUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.client_id,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    }),
  });
  const token = await json(tokenResponse, "OAuth token exchange");
  assert.equal(typeof token.access_token, "string");
  assert.equal(token.token_type?.toLowerCase(), "bearer");
  return token.access_token;
}

async function rpc(accessToken, id, method, params) {
  const response = await request(`${mcpBaseUrl}/mcp`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    }),
  });
  const body = await json(response, `MCP ${method}`);
  assert.equal(body.jsonrpc, "2.0");
  assert.equal(body.id, id);
  assert.ok(!body.error, `MCP ${method} returned ${JSON.stringify(body.error)}`);
  return body.result;
}

async function certifyMcp(accessToken) {
  const initialized = await rpc(accessToken, 1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "nocturne-production-certification", version: "1.0.0" },
  });
  assert.equal(initialized.serverInfo?.name, "nocturne-mcp");

  const tools = await rpc(accessToken, 2, "tools/list", {});
  assert.ok(Array.isArray(tools.tools));
  assert.ok(tools.tools.some((tool) => tool.name === "submit_action"));

  const safeActions = [
    { prompt: "Do one push up.", expected: /push-up|objective/i },
    { prompt: "Stand up.", expected: /routine action|objective|stand/i },
    { prompt: "Stretch my arms.", expected: /routine action|objective|stretch/i },
    { prompt: "Say hello.", expected: /objective|hello|accomplish/i },
    { prompt: "Teleport across town.", expected: /cannot|do not accomplish|physical/i },
  ];
  let id = 10;
  for (const action of safeActions) {
    const result = await rpc(accessToken, id++, "tools/call", {
      name: "submit_action",
      arguments: { text: action.prompt },
    });
    assert.equal(result.isError, undefined, `${action.prompt} returned an MCP tool error`);
    const text = (result.content || [])
      .filter((entry) => entry.type === "text")
      .map((entry) => entry.text)
      .join("\n");
    assert.match(text, action.expected, `${action.prompt} returned unexpected text: ${text}`);
  }
}

await createAccountAndCharacter();
const accessToken = await authorize();
await certifyMcp(accessToken);
console.log(
  JSON.stringify({
    status: "passed",
    account: email,
    character: characterName,
    webBaseUrl,
    mcpBaseUrl,
  }),
);
