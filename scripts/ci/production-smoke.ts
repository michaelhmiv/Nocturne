import { randomUUID } from "node:crypto";

const apiUrl = (
  process.env.NOCTURNE_API_URL || "https://nocturneapi-production.up.railway.app"
).replace(/\/$/, "");
const webUrl = (
  process.env.NOCTURNE_WEB_URL || "https://nocturneweb-production.up.railway.app"
).replace(/\/$/, "");
const token = process.env.NOCTURNE_SMOKE_AGENT_TOKEN?.trim();
let actorId = process.env.NOCTURNE_SMOKE_CHARACTER_ID?.trim();
const expectedCommit = process.env.EXPECTED_COMMIT_SHA;
const guestMode = !token && process.env.NOCTURNE_SMOKE_GUEST_MODE !== "false";
const selfProvision =
  !token && process.env.NOCTURNE_SMOKE_SELF_PROVISION !== "false";
let sessionMode = false;
const cookies = new Map<string, Map<string, string>>();

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function cookieHeader(origin: string) {
  const values = cookies.get(origin);
  return values ? [...values.values()].join("; ") : undefined;
}

function rememberCookies(origin: string, response: Response) {
  const values = cookies.get(origin) || new Map<string, string>();
  const setCookies = response.headers.getSetCookie?.() || [];
  for (const raw of setCookies) {
    const first = raw.split(";", 1)[0];
    const separator = first.indexOf("=");
    if (separator > 0) values.set(first.slice(0, separator), first);
  }
  if (values.size) cookies.set(origin, values);
}

function requestHeaders(extra?: Record<string, string>) {
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(guestMode && !sessionMode ? { "x-nocturne-guest-mode": "1" } : {}),
    ...extra,
  };
}

async function jsonRequest(url: string, init: RequestInit = {}) {
  const parsed = new URL(url);
  const headers = new Headers(init.headers || {});
  const cookie = cookieHeader(parsed.origin);
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(parsed, { ...init, headers });
  rememberCookies(parsed.origin, response);
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(
      `${init?.method || "GET"} ${url} returned ${response.status}: ${text.slice(0, 1000)}`,
    );
  }
  return payload as Record<string, unknown>;
}

async function waitForDeployment() {
  const deadline = Date.now() + 12 * 60_000;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const health = await jsonRequest(`${apiUrl}/health`);
      const build = await jsonRequest(`${apiUrl}/v1/system/build`);
      const commitSha = typeof build.commitSha === "string" ? build.commitSha : null;
      if (health.status === "ok" && (!expectedCommit || commitSha === expectedCommit)) {
        return { health, build };
      }
      last = { health, build, expectedCommit };
    } catch (error) {
      last = error instanceof Error ? error.message : error;
    }
    await sleep(15_000);
  }
  throw new Error(`Timed out waiting for deployed commit: ${JSON.stringify(last)}`);
}

async function provisionPlayer() {
  const provisionId = randomUUID();
  const email = `production-smoke-${provisionId}@example.invalid`;
  const password = `Nocturne-Smoke-${provisionId}!`;
  const characterName = `Production Smoke ${provisionId.slice(0, 8)}`;

  await jsonRequest(`${webUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Nocturne Production Smoke",
      email,
      password,
    }),
  });
  sessionMode = true;

  const created = await jsonRequest(`${webUrl}/api/game/characters`, {
    method: "POST",
    headers: requestHeaders({
      "content-type": "application/json",
      "idempotency-key": `production-smoke:character:${provisionId}`,
    }),
    body: JSON.stringify({
      name: characterName,
      conceptSummary: "A disposable character used by the production deployment smoke test.",
    }),
  });
  const nestedCharacter =
    created.character && typeof created.character === "object"
      ? (created.character as Record<string, unknown>)
      : null;
  const createdActorId =
    typeof created.characterId === "string"
      ? created.characterId
      : typeof nestedCharacter?.characterId === "string"
        ? nestedCharacter.characterId
        : null;
  if (!createdActorId) {
    throw new Error(`Production smoke could not create a character: ${JSON.stringify(created)}`);
  }
  actorId = createdActorId;

  await jsonRequest(`${webUrl}/api/game/characters/${actorId}/select`, {
    method: "POST",
    headers: requestHeaders({ "content-type": "application/json" }),
  });
  await jsonRequest(`${webUrl}/api/game/residences/starter/rent`, {
    method: "POST",
    headers: requestHeaders({
      "content-type": "application/json",
      "idempotency-key": `production-smoke:residence:${provisionId}`,
    }),
    body: JSON.stringify({ characterId: actorId }),
  });
  return actorId;
}

async function resolveActorId() {
  if (actorId) return actorId;
  if (selfProvision) {
    try {
      const payload = await jsonRequest(`${webUrl}/api/game/characters`, {
        headers: requestHeaders(),
      });
      const characters = Array.isArray(payload.characters)
        ? (payload.characters as Array<Record<string, unknown>>)
        : [];
      const selected =
        characters.find((character) => character.selected === true) || characters[0];
      const resolved = selected?.characterId;
      if (typeof resolved === "string" && resolved) {
        actorId = resolved;
        return resolved;
      }
    } catch (error) {
      console.warn(
        `Production smoke could not use the configured guest/session identity; self-provisioning: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return provisionPlayer();
  }

  const payload = await jsonRequest(`${webUrl}/api/game/characters`, {
    headers: requestHeaders(),
  });
  const characters = Array.isArray(payload.characters)
    ? (payload.characters as Array<Record<string, unknown>>)
    : [];
  const selected = characters.find((character) => character.selected === true) || characters[0];
  const resolved = selected?.characterId;
  if (typeof resolved !== "string" || !resolved) {
    throw new Error(
      "Production smoke could not resolve a selected character. Configure NOCTURNE_SMOKE_CHARACTER_ID or create a playable character.",
    );
  }
  actorId = resolved;
  return resolved;
}

async function submit(command: string, label: string) {
  const selectedActorId = await resolveActorId();
  const idempotencyKey = `production-smoke:${label}:${randomUUID()}`;
  const traceId = `production-smoke-${label}-${randomUUID()}`;
  const payload = await jsonRequest(`${webUrl}/api/game/persistent-world/actions`, {
    method: "POST",
    headers: requestHeaders({
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
      "x-nocturne-trace-id": traceId,
    }),
    body: JSON.stringify({ actorId: selectedActorId, command }),
  });
  if (payload.error === "internal_error" || payload.error === "request_failed") {
    throw new Error(`${label} returned an infrastructure failure: ${JSON.stringify(payload)}`);
  }
  if (!["completed", "waiting"].includes(String(payload.state))) {
    throw new Error(
      `${label} did not produce an executable player result: ${JSON.stringify(payload)}`,
    );
  }
  if (typeof payload.requestId !== "string") {
    throw new Error(`${label} did not return requestId: ${JSON.stringify(payload)}`);
  }
  return {
    label,
    traceId,
    requestId: payload.requestId,
    state: payload.state,
    narration: typeof payload.narration === "string" ? payload.narration.slice(0, 500) : null,
  };
}

const deployment = await waitForDeployment();
await jsonRequest(`${apiUrl}/ready`);
const provider = await jsonRequest(`${apiUrl}/v1/system/ai-provider`);
if (provider.configured !== true) {
  throw new Error(`Production provider is not configured: ${JSON.stringify(provider)}`);
}

const selectedActorId = await resolveActorId();
const results = [
  await submit("I look around the room and take in my surroundings.", "observe"),
  await submit("I drink a glass of water from the ordinary kitchen provisions.", "consume"),
];

console.log(
  JSON.stringify(
    {
      status: "passed",
      deployment,
      provider,
      authentication: token ? "agent_token" : "guest_mode",
      actorId: selectedActorId,
      results,
    },
    null,
    2,
  ),
);
