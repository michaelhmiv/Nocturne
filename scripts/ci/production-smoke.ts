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

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function requestHeaders(extra?: Record<string, string>) {
  return {
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(guestMode ? { "x-nocturne-guest-mode": "1" } : {}),
    ...extra,
  };
}

async function jsonRequest(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
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

async function resolveActorId() {
  if (actorId) return actorId;
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
