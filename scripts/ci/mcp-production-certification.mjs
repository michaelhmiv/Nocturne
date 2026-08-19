import { createHash, randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { KNOWN_MCP_PRODUCTION_REGRESSIONS } from "./mcp-known-regressions.mjs";

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
const results = [];
let rpcId = 1;

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
  if (parsed.origin === webOrigin && !headers.has("origin")) headers.set("origin", webOrigin);
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

function toolPayload(result) {
  if (result?.structuredContent !== undefined) return result.structuredContent;
  const text = (result?.content || [])
    .filter((entry) => entry?.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text)
    .join("\n");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function toolText(result) {
  return (result?.content || [])
    .filter((entry) => entry?.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text)
    .join("\n");
}

async function createAccount() {
  const signup = await request(`${webBaseUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Nocturne MCP Certification", email, password }),
  });
  await json(signup, "Better Auth sign-up");
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
  authorizeUrl.searchParams.set("scope", "nocturne.read nocturne.write offline_access");
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

async function rpc(accessToken, method, params) {
  const id = rpcId++;
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

async function callTool(accessToken, name, args = {}, { allowError = false } = {}) {
  const result = await rpc(accessToken, "tools/call", { name, arguments: args });
  if (!allowError) {
    assert.notEqual(
      result?.isError,
      true,
      `${name} returned an MCP tool error: ${toolText(result) || JSON.stringify(toolPayload(result))}`,
    );
  }
  return result;
}

async function payloadTool(accessToken, name, args = {}, options) {
  return toolPayload(await callTool(accessToken, name, args, options));
}

function idFrom(value, keys) {
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === "string" && candidate) return candidate;
  }
  return null;
}

function resultRequestId(result) {
  const payload = toolPayload(result);
  return idFrom(payload, ["requestId"]) || idFrom(payload?.plan, ["requestId"]);
}

function resultState(result) {
  return toolPayload(result)?.state || null;
}

function resultNarrativeText(result) {
  const payload = toolPayload(result);
  return [toolText(result), payload?.narration, payload?.prompt, payload?.error, payload?.message]
    .filter((value) => typeof value === "string")
    .join("\n");
}

async function getDashboard(accessToken) {
  const payload = await payloadTool(accessToken, "get_dashboard", { historyLimit: 200 });
  assert.ok(payload?.dashboard?.character, "get_dashboard must return a character projection");
  return payload;
}

async function getScene(accessToken) {
  const scene = await payloadTool(accessToken, "get_scene");
  assert.ok(scene?.actorId, "get_scene must return an actorId");
  return scene;
}

async function inspectEntity(accessToken, entityId) {
  const entity = await payloadTool(accessToken, "inspect_world_entity", { entityId });
  assert.equal(entity?.entityId, entityId, `inspection must return ${entityId}`);
  return entity;
}

async function getOperatorDashboard(accessToken, actorId) {
  const dashboard = await payloadTool(accessToken, "get_operator_dashboard", {
    actorId,
    limit: 100,
  });
  assert.equal(dashboard?.actorId, actorId);
  assert.ok(Array.isArray(dashboard?.traces));
  return dashboard;
}

async function getTrace(accessToken, actorId, requestId, { attempts = 10 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const dashboard = await getOperatorDashboard(accessToken, actorId);
    const trace = dashboard.traces.find((candidate) => candidate.requestId === requestId);
    if (trace) return trace;
    await sleep(1000);
  }
  throw new Error(`operator trace ${requestId} was not found for ${actorId}`);
}

async function submitAction(accessToken, actorId, text, options = {}) {
  return callTool(
    accessToken,
    "submit_action",
    {
      text,
      actorId,
      idempotencyKey: options.idempotencyKey || `mcp-cert-${runId}-${randomUUID()}`,
      traceId: options.traceId || `mcp-cert-${runId}-${randomUUID()}`,
    },
    { allowError: options.allowError ?? true },
  );
}

function relationOwnershipFingerprint(entity) {
  return (entity?.relations || [])
    .filter((relation) =>
      /own|possess|belong/i.test(String(relation.relation_type || relation.relationType || "")),
    )
    .map((relation) => JSON.stringify(relation))
    .sort();
}

function eventTypes(entity) {
  return (entity?.recentEvents || []).map((event) =>
    String(event.event_type || event.eventType || event.type || ""),
  );
}

async function setupPlayer(accessToken) {
  const created = await payloadTool(accessToken, "create_character", {
    name: characterName,
    conceptSummary:
      "A disposable certification character used only for safe MCP action, timing, reference, and persistence tests.",
    idempotencyKey: `mcp-cert-character-${runId}`,
  });
  const actorId =
    idFrom(created, ["characterId", "id"]) || idFrom(created?.character, ["id", "characterId"]);
  assert.ok(actorId, `create_character did not return a character id: ${JSON.stringify(created)}`);

  await payloadTool(accessToken, "select_character", { characterId: actorId });
  const rent = await payloadTool(accessToken, "rent_starter_residence", {
    characterId: actorId,
    idempotencyKey: `mcp-cert-residence-${runId}`,
  });
  const residenceId = idFrom(rent, ["residenceId"]);
  assert.ok(
    residenceId,
    `rent_starter_residence did not return residenceId: ${JSON.stringify(rent)}`,
  );
  const dashboard = await getDashboard(accessToken);
  assert.equal(dashboard.dashboard.character.characterId, actorId);
  assert.equal(dashboard.dashboard.character.residenceId, residenceId);
  return { actorId, residenceId };
}

async function runCase(regression, execute) {
  const startedAt = new Date().toISOString();
  try {
    const evidence = await execute();
    results.push({
      id: regression.id,
      title: regression.title,
      status: "passed",
      startedAt,
      evidence,
    });
    console.log(`PASS ${regression.id}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({
      id: regression.id,
      title: regression.title,
      status: "failed",
      startedAt,
      error: message,
    });
    console.error(`FAIL ${regression.id}: ${message}`);
  }
}

function requireFailureSemantics(result, noun) {
  const text = resultNarrativeText(result);
  const failedState =
    ["failed", "completed"].includes(String(resultState(result))) || result?.isError === true;
  assert.ok(failedState, `${noun} action must resolve instead of remaining ambiguous: ${text}`);
  assert.match(
    text,
    new RegExp(
      `(${noun}|missing|do not have|don't have|not have|without|cannot|can't|possess)`,
      "i",
    ),
    `${noun} failure must be player-visible: ${text}`,
  );
}

async function certifyPreflight(accessToken) {
  const initialized = await rpc(accessToken, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "nocturne-production-certification", version: "2.0.0" },
  });
  assert.equal(initialized.serverInfo?.name, "nocturne-mcp");
  assert.match(initialized.instructions || "", /authoritative game world/i);

  const listed = await rpc(accessToken, "tools/list", {});
  const names = new Set((listed.tools || []).map((tool) => tool.name));
  for (const name of [
    "create_character",
    "select_character",
    "rent_starter_residence",
    "get_scene",
    "get_dashboard",
    "submit_action",
    "get_travel_path",
    "get_operator_dashboard",
    "inspect_world_entity",
  ]) {
    assert.ok(names.has(name), `production certification requires diagnostic tool ${name}`);
  }

  const health = await payloadTool(accessToken, "nocturne_health");
  assert.equal(health?.api?.status, "ok");
  assert.equal(health?.operational?.status, "ready");
  assert.equal(health?.operational?.database?.ready, true);
  assert.equal(health?.operational?.database?.migrationsReady, true);
  assert.equal(health?.operational?.worker?.configured, true);
  assert.equal(health?.operational?.worker?.online, true);
  return health;
}

async function certifyKnownRegressions(accessToken, player) {
  const { actorId, residenceId } = player;
  const byId = new Map(
    KNOWN_MCP_PRODUCTION_REGRESSIONS.map((regression) => [regression.id, regression]),
  );

  await runCase(byId.get("certification-entities-inspectable"), async () => {
    const [actor, residence] = await Promise.all([
      inspectEntity(accessToken, actorId),
      inspectEntity(accessToken, residenceId),
    ]);
    return {
      actor: {
        entityId: actor.entityId,
        version: actor.version,
        origin: actor.provenance?.[0]?.source_type,
      },
      residence: {
        entityId: residence.entityId,
        version: residence.version,
        locationId: residence.locationId,
      },
    };
  });

  await runCase(byId.get("starter-unit-route-connected"), async () => {
    const [scene, world] = await Promise.all([
      getScene(accessToken),
      payloadTool(accessToken, "get_world_start"),
    ]);
    const fromLocationId = scene.location?.locationId;
    const toLocationId = world?.alley?.id;
    assert.ok(fromLocationId, "starter character must have a current residence location");
    assert.ok(toLocationId, "starter world must expose the alley route target");
    assert.notEqual(fromLocationId, toLocationId);
    const path = await payloadTool(accessToken, "get_travel_path", {
      fromLocationId,
      toLocationId,
      speedFactor: 1,
    });
    assert.ok(
      path && typeof path === "object",
      "dynamic starter unit must have a route to the starter alley",
    );
    return { fromLocationId, toLocationId, path };
  });

  for (const id of ["missing-sandwich-no-mutation", "missing-pistol-cannot-discharge"]) {
    await runCase(byId.get(id), async () => {
      const regression = byId.get(id);
      const before = await inspectEntity(accessToken, actorId);
      const result = await submitAction(accessToken, actorId, regression.prompts[0]);
      requireFailureSemantics(result, id.includes("sandwich") ? "sandwich" : "pistol");
      const requestId = resultRequestId(result);
      const after = await inspectEntity(accessToken, actorId);
      assert.equal(
        after.version,
        before.version,
        `${id} must not increment character entity version`,
      );
      assert.equal(
        after.simulationVersion,
        before.simulationVersion,
        `${id} must not increment character simulation version`,
      );
      if (id.includes("pistol")) {
        const newEvents = eventTypes(after).slice(
          0,
          Math.max(0, eventTypes(after).length - eventTypes(before).length),
        );
        assert.ok(
          !newEvents.some((eventType) => /discharge|gunshot|shoot|firearm_fired/i.test(eventType)),
          `missing pistol cannot create a discharge event: ${newEvents.join(", ")}`,
        );
      }
      const trace = requestId ? await getTrace(accessToken, actorId, requestId) : null;
      return { requestId, beforeVersion: before.version, afterVersion: after.version, trace };
    });
  }

  await runCase(byId.get("missing-knife-before-secondary-clarification"), async () => {
    const regression = byId.get("missing-knife-before-secondary-clarification");
    const result = await submitAction(accessToken, actorId, regression.prompts[0]);
    assert.notEqual(
      resultState(result),
      "waiting_for_clarification",
      "missing knife must be resolved before asking which secondary target 'it' means",
    );
    const text = resultNarrativeText(result);
    assert.match(text, /knife|missing|do not have|don't have|not have|possess/i);
    const requestId = resultRequestId(result);
    return {
      requestId,
      state: resultState(result),
      text,
      trace: requestId ? await getTrace(accessToken, actorId, requestId) : null,
    };
  });

  await runCase(byId.get("dialogue-claim-does-not-create-ownership"), async () => {
    const scene = await getScene(accessToken);
    const candidates = [...(scene.nearbyEntities || []), ...(scene.knownEntities || [])];
    const target =
      candidates.find((entity) => /chair/i.test(entity.name)) ||
      candidates.find((entity) => /table|desk/i.test(entity.name));
    assert.ok(
      target?.entityId,
      "starter unit must expose a chair/table/desk fixture for claim-causality certification",
    );
    const before = await inspectEntity(accessToken, target.entityId);
    const ownershipBefore = relationOwnershipFingerprint(before);
    const result = await submitAction(
      accessToken,
      actorId,
      `Say out loud, '${target.name} belongs to me.'`,
    );
    assert.notEqual(
      result?.isError,
      true,
      `dialogue claim failed unexpectedly: ${resultNarrativeText(result)}`,
    );
    const after = await inspectEntity(accessToken, target.entityId);
    assert.equal(
      after.ownerId,
      before.ownerId,
      "dialogue narration cannot assign authoritative ownership",
    );
    assert.deepEqual(
      relationOwnershipFingerprint(after),
      ownershipBefore,
      "dialogue narration cannot create an ownership relation",
    );
    const requestId = resultRequestId(result);
    return {
      targetId: target.entityId,
      ownerId: after.ownerId,
      requestId,
      trace: requestId ? await getTrace(accessToken, actorId, requestId) : null,
    };
  });

  await runCase(byId.get("search-materializes-discovery"), async () => {
    const regression = byId.get("search-materializes-discovery");
    const beforeScene = await getScene(accessToken);
    const beforeIds = new Set(
      [...(beforeScene.nearbyEntities || []), ...(beforeScene.knownEntities || [])].map(
        (entity) => entity.entityId,
      ),
    );
    const beforeActor = await inspectEntity(accessToken, actorId);
    const result = await submitAction(accessToken, actorId, regression.prompts[0]);
    assert.notEqual(result?.isError, true, `search must resolve: ${resultNarrativeText(result)}`);
    assert.notEqual(resultState(result), "waiting_for_clarification");
    const afterScene = await getScene(accessToken);
    const newEntities = [
      ...(afterScene.nearbyEntities || []),
      ...(afterScene.knownEntities || []),
    ].filter((entity) => !beforeIds.has(entity.entityId));
    const afterActor = await inspectEntity(accessToken, actorId);
    const newEventText = (afterActor.recentEvents || [])
      .slice(
        0,
        Math.max(
          0,
          (afterActor.recentEvents || []).length - (beforeActor.recentEvents || []).length,
        ),
      )
      .map((event) => JSON.stringify(event))
      .join("\n");
    const requestId = resultRequestId(result);
    const trace = requestId ? await getTrace(accessToken, actorId, requestId) : null;
    assert.ok(
      newEntities.length > 0 ||
        /search|discover|materializ|found/i.test(`${newEventText}\n${JSON.stringify(trace)}`),
      "search must leave authoritative discovery/materialization evidence",
    );
    for (const entity of newEntities.slice(0, 3)) await inspectEntity(accessToken, entity.entityId);
    return { requestId, newEntityIds: newEntities.map((entity) => entity.entityId), trace };
  });

  await runCase(byId.get("current-unit-deixis"), async () => {
    const regression = byId.get("current-unit-deixis");
    const scene = await getScene(accessToken);
    const result = await submitAction(accessToken, actorId, regression.prompts[0]);
    assert.notEqual(
      result?.isError,
      true,
      `current-unit action must resolve: ${resultNarrativeText(result)}`,
    );
    assert.notEqual(
      resultState(result),
      "waiting_for_clarification",
      "'my current unit' must resolve without asking which unit",
    );
    const requestId = resultRequestId(result);
    const trace = requestId ? await getTrace(accessToken, actorId, requestId) : null;
    assert.ok(
      trace?.contextCompilationId,
      "current-unit deixis must compile authoritative context",
    );
    return { requestId, locationId: scene.location?.locationId, trace };
  });

  await runCase(byId.get("unique-vehicle-insufficient-funds"), async () => {
    const before = await inspectEntity(accessToken, actorId);
    const vehiclesPayload = await payloadTool(accessToken, "list_vehicles");
    const vehicles = Array.isArray(vehiclesPayload)
      ? vehiclesPayload
      : vehiclesPayload?.vehicles || [];
    const cash = Number((await getDashboard(accessToken)).dashboard.character.cashOnPerson || 0);
    const unowned = vehicles.filter((vehicle) => !vehicle.ownerId);
    const listing = unowned
      .map((vehicle) => ({
        ...vehicle,
        priceCents: Number(
          vehicle.priceCents ?? vehicle.price_cents ?? vehicle.state?.priceCents ?? 0,
        ),
      }))
      .filter((vehicle) => vehicle.priceCents > cash)
      .sort((a, b) => b.priceCents - a.priceCents)[0];
    assert.ok(
      listing,
      `production needs a unique unowned vehicle listing priced above starter cash ${cash}`,
    );
    const name = listing.name || listing.title || listing.state?.name;
    assert.ok(
      name,
      `vehicle listing must have a player-addressable name: ${JSON.stringify(listing)}`,
    );
    const result = await submitAction(
      accessToken,
      actorId,
      `Buy the ${name} for its listed price.`,
    );
    const text = resultNarrativeText(result);
    assert.match(
      text,
      /insufficient|cannot afford|can't afford|not enough|funds|money|cash/i,
      `purchase must reach insufficient-funds validation: ${text}`,
    );
    const after = await inspectEntity(accessToken, actorId);
    assert.equal(
      after.version,
      before.version,
      "insufficient-funds purchase must not mutate character version",
    );
    const requestId = resultRequestId(result);
    return {
      listing: { vehicleId: listing.vehicleId, name, priceCents: listing.priceCents },
      cash,
      requestId,
      trace: requestId ? await getTrace(accessToken, actorId, requestId) : null,
    };
  });

  await runCase(byId.get("bare-fist-is-anatomy"), async () => {
    const regression = byId.get("bare-fist-is-anatomy");
    const result = await submitAction(accessToken, actorId, regression.prompts[0]);
    const text = resultNarrativeText(result);
    assert.notEqual(
      result?.isError,
      true,
      `bare-fist action must reach action resolution: ${text}`,
    );
    assert.notEqual(resultState(result), "waiting_for_clarification");
    assert.doesNotMatch(
      text,
      /missing (?:a )?fist|do not have (?:a )?fist|don't have (?:a )?fist|possess (?:a )?fist/i,
    );
    const requestId = resultRequestId(result);
    const trace = requestId ? await getTrace(accessToken, actorId, requestId) : null;
    assert.ok(
      trace?.planId,
      "bare-fist action must create an executable plan rather than an inventory prerequisite failure",
    );
    return { requestId, trace };
  });

  await runCase(byId.get("failed-movement-terminalizes"), async () => {
    const regression = byId.get("failed-movement-terminalizes");
    const result = await submitAction(accessToken, actorId, regression.prompts[0]);
    assert.notEqual(
      resultState(result),
      "waiting_for_clarification",
      "physically impossible movement should terminalize, not remain unresolved",
    );
    const requestId = resultRequestId(result);
    assert.ok(requestId, `failed movement must expose requestId: ${resultNarrativeText(result)}`);
    const trace = await getTrace(accessToken, actorId, requestId);
    assert.ok(
      ["failed", "completed"].includes(trace.status),
      `failed movement request must be terminal, got ${trace.status}`,
    );
    assert.ok(trace.completedAt, "terminalized movement request must have completedAt");
    assert.ok(
      !(trace.stages || []).some((stage) => ["started", "waiting"].includes(stage.status)),
      `terminalized movement cannot leave execution stages active: ${JSON.stringify(trace.stages)}`,
    );
    const actor = await inspectEntity(accessToken, actorId);
    if (trace.planId) {
      assert.ok(
        !(actor.activePlans || []).some((plan) => (plan.plan_id || plan.planId) === trace.planId),
        "terminalized failed movement cannot leave its plan active",
      );
    }
    return { requestId, traceStatus: trace.status, planId: trace.planId, stages: trace.stages };
  });

  await runCase(byId.get("clarification-reply-resumes-original-request"), async () => {
    const regression = byId.get("clarification-reply-resumes-original-request");
    const beforeScene = await getScene(accessToken);
    const first = await submitAction(accessToken, actorId, regression.prompts[0]);
    assert.equal(
      resultState(first),
      "waiting_for_clarification",
      `ambiguous movement must ask for clarification: ${resultNarrativeText(first)}`,
    );
    const firstRequestId = resultRequestId(first);
    assert.ok(firstRequestId);
    const second = await submitAction(accessToken, actorId, regression.prompts[1]);
    assert.notEqual(
      second?.isError,
      true,
      `clarification reply must resume play: ${resultNarrativeText(second)}`,
    );
    assert.notEqual(
      resultState(second),
      "waiting_for_clarification",
      `clarification reply must resolve the pending destination: ${resultNarrativeText(second)}`,
    );
    const secondRequestId = resultRequestId(second);
    assert.ok(secondRequestId);
    const [firstTrace, secondTrace, afterScene] = await Promise.all([
      getTrace(accessToken, actorId, firstRequestId),
      getTrace(accessToken, actorId, secondRequestId),
      getScene(accessToken),
    ]);
    assert.equal(firstTrace.status, "waiting_for_clarification");
    const resumedEvidence =
      beforeScene.location?.locationId !== afterScene.location?.locationId ||
      (afterScene.scheduledWork || []).some((work) =>
        /travel|move|walk/i.test(`${work.kind} ${work.description}`),
      ) ||
      /walk|move|travel|hallway|destination/i.test(
        JSON.stringify(secondTrace.playerSafeResult || secondTrace.authoritativeResult || {}),
      );
    assert.ok(
      resumedEvidence,
      "clarification reply must continue the original movement intent, not become an unrelated standalone turn",
    );
    return {
      firstRequestId,
      secondRequestId,
      beforeLocationId: beforeScene.location?.locationId,
      afterLocationId: afterScene.location?.locationId,
      firstTrace,
      secondTrace,
    };
  });

  await runCase(byId.get("idempotent-replay-original-records"), async () => {
    const regression = byId.get("idempotent-replay-original-records");
    const key = `mcp-cert-replay-${runId}`;
    const first = await submitAction(accessToken, actorId, regression.prompts[0], {
      idempotencyKey: key,
    });
    assert.notEqual(first?.isError, true, resultNarrativeText(first));
    const firstRequestId = resultRequestId(first);
    assert.ok(firstRequestId);
    const firstTrace = await getTrace(accessToken, actorId, firstRequestId);
    const replay = await submitAction(accessToken, actorId, regression.prompts[0], {
      idempotencyKey: key,
    });
    assert.notEqual(replay?.isError, true, resultNarrativeText(replay));
    const replayRequestId = resultRequestId(replay);
    assert.equal(
      replayRequestId,
      firstRequestId,
      "idempotent replay must return original requestId",
    );
    const replayTrace = await getTrace(accessToken, actorId, replayRequestId);
    assert.equal(replayTrace.planId, firstTrace.planId);
    assert.equal(replayTrace.createdAt, firstTrace.createdAt);
    assert.deepEqual(
      (replayTrace.stages || []).map((stage) => stage.stageId),
      (firstTrace.stages || []).map((stage) => stage.stageId),
      "idempotent replay must return original execution records rather than duplicating stages",
    );
    return {
      idempotencyKey: key,
      requestId: firstRequestId,
      planId: firstTrace.planId,
      stageIds: firstTrace.stages.map((stage) => stage.stageId),
    };
  });

  await runCase(byId.get("idempotency-conflict-rejected"), async () => {
    const regression = byId.get("idempotency-conflict-rejected");
    const key = `mcp-cert-conflict-${runId}`;
    const first = await submitAction(accessToken, actorId, regression.prompts[0], {
      idempotencyKey: key,
    });
    assert.notEqual(first?.isError, true, resultNarrativeText(first));
    const firstRequestId = resultRequestId(first);
    assert.ok(firstRequestId);
    const conflict = await submitAction(accessToken, actorId, regression.prompts[1], {
      idempotencyKey: key,
      allowError: true,
    });
    const payload = toolPayload(conflict);
    const text = resultNarrativeText(conflict);
    assert.equal(
      conflict?.isError,
      true,
      `same idempotency key with different command must be rejected: ${text}`,
    );
    assert.ok(
      payload?.status === 409 ||
        /idempoten|conflict|same.*key|different.*request/i.test(
          `${text}\n${JSON.stringify(payload)}`,
        ),
      `idempotency conflict must be identifiable: ${text}`,
    );
    const firstTrace = await getTrace(accessToken, actorId, firstRequestId);
    return {
      idempotencyKey: key,
      originalRequestId: firstRequestId,
      conflict: payload,
      originalTrace: firstTrace,
    };
  });

  await runCase(byId.get("explicit-two-minute-exercise-real-time"), async () => {
    const regression = byId.get("explicit-two-minute-exercise-real-time");
    const startedMs = Date.now();
    const result = await submitAction(accessToken, actorId, regression.prompts[0]);
    assert.notEqual(
      result?.isError,
      true,
      `timed exercise must schedule: ${resultNarrativeText(result)}`,
    );
    assert.equal(
      resultState(result),
      "waiting",
      `two-minute exercise must not complete synchronously: ${resultNarrativeText(result)}`,
    );
    const requestId = resultRequestId(result);
    assert.ok(requestId);
    const trace = await getTrace(accessToken, actorId, requestId);
    const planId = trace.planId || toolPayload(result)?.plan?.planId;
    assert.ok(planId, "two-minute exercise must have a planId");
    const initialActor = await inspectEntity(accessToken, actorId);
    const scheduled = (initialActor.scheduledWork || []).find(
      (work) =>
        (work.plan_id || work.planId) === planId &&
        !["completed", "cancelled", "failed"].includes(String(work.status)),
    );
    assert.ok(
      scheduled,
      `two-minute exercise must create scheduled work: ${JSON.stringify(initialActor.scheduledWork)}`,
    );
    const resolvesAt = Date.parse(String(scheduled.resolves_at || scheduled.resolvesAt));
    assert.ok(
      Number.isFinite(resolvesAt),
      `scheduled work must have resolvesAt: ${JSON.stringify(scheduled)}`,
    );
    const scheduledDelayMs = resolvesAt - startedMs;
    assert.ok(
      scheduledDelayMs >= 110_000 && scheduledDelayMs <= 140_000,
      `explicit two-minute duration must schedule near 120 seconds, got ${Math.round(scheduledDelayMs / 1000)}s`,
    );

    const earlyCheckAt = startedMs + 105_000;
    if (Date.now() < earlyCheckAt) await sleep(earlyCheckAt - Date.now());
    const earlyTrace = await getTrace(accessToken, actorId, requestId);
    assert.ok(
      ["waiting", "executing"].includes(earlyTrace.status),
      `two-minute exercise completed too early at ${Math.round((Date.now() - startedMs) / 1000)}s`,
    );

    const deadline = startedMs + 165_000;
    let finalTrace = earlyTrace;
    while (Date.now() < deadline) {
      await sleep(5000);
      finalTrace = await getTrace(accessToken, actorId, requestId);
      if (["completed", "failed"].includes(finalTrace.status)) break;
    }
    assert.equal(
      finalTrace.status,
      "completed",
      `two-minute exercise did not complete after real time: ${JSON.stringify(finalTrace)}`,
    );
    const elapsedMs = Date.now() - startedMs;
    assert.ok(
      elapsedMs >= 110_000,
      `two-minute exercise completed before the real-time lower bound: ${elapsedMs}ms`,
    );
    return {
      requestId,
      planId,
      resolvesAt: new Date(resolvesAt).toISOString(),
      scheduledDelaySeconds: Math.round(scheduledDelayMs / 1000),
      observedElapsedSeconds: Math.round(elapsedMs / 1000),
      trace: finalTrace,
    };
  });
}

await createAccount();
const accessToken = await authorize();
const health = await certifyPreflight(accessToken);
const player = await setupPlayer(accessToken);
await certifyKnownRegressions(accessToken, player);

const failed = results.filter((result) => result.status === "failed");
const report = {
  status: failed.length ? "failed" : "passed",
  runId,
  account: email,
  character: characterName,
  actorId: player.actorId,
  residenceId: player.residenceId,
  webBaseUrl,
  mcpBaseUrl,
  deployment: health?.operational?.deployment || null,
  passed: results.length - failed.length,
  failed: failed.length,
  expectedCases: KNOWN_MCP_PRODUCTION_REGRESSIONS.length,
  results,
};
console.log(JSON.stringify(report, null, 2));
assert.equal(
  results.length,
  KNOWN_MCP_PRODUCTION_REGRESSIONS.length,
  "every known regression must execute",
);
assert.equal(failed.length, 0, `${failed.length} known MCP production regression(s) failed`);
