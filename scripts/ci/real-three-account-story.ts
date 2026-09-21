import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createDatabase } from "../../packages/database/src/index.js";
import { closeAuthFromEnv, getAuthFromEnv } from "../../packages/auth/src/index.js";

const apiBase = process.env.NOCTURNE_API_URL || "http://127.0.0.1:3101";
const webBase = process.env.NOCTURNE_WEB_URL || "http://127.0.0.1:3000";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL must point to a disposable CI database.");
if (process.env.NOCTURNE_GUEST_MODE === "true") {
  throw new Error("Multi-account story smoke refuses shared guest mode.");
}
if (process.env.NOCTURNE_STORY_ISOLATED_DB !== "true") {
  throw new Error("Multi-account story smoke requires explicit isolated DB gate.");
}

const db = createDatabase(databaseUrl);
const storyId = randomUUID();
const names = [
  { alias: "mara", name: "Mara Velez" },
  { alias: "dax", name: "Dax Mercer" },
  { alias: "imani", name: "Imani Brooks" },
];

type Persona = {
  alias: string;
  name: string;
  cookie: string;
  userId: string;
  actorId: string;
  residenceId: string;
};

async function api(path: string, cookie: string, init: RequestInit = {}) {
  const response = await fetch(apiBase + path, {
    ...init,
    headers: {
      "content-type": "application/json",
      cookie,
      ...(init.headers || {}),
    },
  });
  const body = await response.text();
  let payload: Record<string, any>;
  try {
    payload = body ? JSON.parse(body) : {};
  } catch {
    throw new Error(path + " returned invalid JSON: status " + response.status);
  }
  return { response, payload };
}

async function ok(path: string, cookie: string, init: RequestInit = {}) {
  const result = await api(path, cookie, init);
  assert.ok(
    result.response.ok,
    (init.method || "GET") + " " + path + " -> HTTP " + result.response.status +
      ": " + JSON.stringify(result.payload).slice(0, 500),
  );
  return result.payload;
}

async function signup(alias: string, name: string) {
  const email = "story-" + storyId + "-" + alias + "@example.invalid";
  const password = "CI-story-" + randomUUID() + "!9a";
  const response = await getAuthFromEnv().handler(
    new Request(webBase + "/api/auth/sign-up/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: webBase,
      },
      body: JSON.stringify({ name, email, password }),
    }),
  );
  assert.ok(response.ok, "Independent " + alias + " signup failed: " + response.status);
  const cookie = response.headers
    .getSetCookie()
    .map((line) => line.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
  assert.ok(cookie.includes("session_token="), alias + " needs real session cookie");
  const session = await ok("/v1/me", cookie);
  assert.ok(session?.user?.id, "Real API could not authenticate " + alias);
  return { cookie, userId: String(session.user.id) };
}

async function createPersona(input: (typeof names)[number]): Promise<Persona> {
  const { cookie, userId } = await signup(input.alias, input.name);
  await ok("/v1/world/start", cookie);
  const created = await ok("/v1/characters", cookie, {
    method: "POST",
    headers: { "idempotency-key": "ci-story-character-" + storyId + "-" + input.alias },
    body: JSON.stringify({
      name: input.name,
      conceptSummary: "Original three-account story certification tenant " + input.alias,
      originSource: "ci",
    }),
  });
  const actorId = String(created.characterId || "");
  assert.ok(actorId, "Missing persisted actor ID for " + input.alias);
  await ok("/v1/characters/" + actorId + "/select", cookie, {
    method: "POST",
    body: "{}",
  });
  const rented = await ok("/v1/residences/starter/rent", cookie, {
    method: "POST",
    headers: { "idempotency-key": "ci-story-home-" + storyId + "-" + input.alias },
    body: JSON.stringify({ characterId: actorId }),
  });
  const residenceId = String(rented.residenceId || "");
  assert.ok(residenceId, "Missing persistent residence for " + input.alias);
  const scene = await ok("/v1/persistent-world/scene", cookie);
  assert.equal(scene.actorId, actorId);
  assert.equal(scene.location?.locationId, residenceId);
  return { ...input, cookie, userId, actorId, residenceId };
}

async function submit(persona: Persona, text: string, key: string) {
  const result = await ok("/v1/persistent-world/actions", persona.cookie, {
    method: "POST",
    headers: { "idempotency-key": key },
    body: JSON.stringify({ actorId: persona.actorId, command: text }),
  });
  assert.equal(result.state, "completed", persona.alias + " could not execute " + text);
  assert.ok(result.requestId, "Missing action request ID");
  assert.ok(result.plan?.planId, "Missing persistent action plan");
  assert.ok(result.eventIds?.length, "Completed action lacks event IDs");
  assert.ok(typeof result.narration === "string" && result.narration.trim(), "No narration");
  return result;
}

async function main() {
  const personas: Persona[] = [];
  for (const name of names) personas.push(await createPersona(name));
  assert.equal(new Set(personas.map((p) => p.userId)).size, 3, "Accounts must be independent");
  assert.equal(new Set(personas.map((p) => p.actorId)).size, 3, "Actors must be independent");
  assert.equal(new Set(personas.map((p) => p.residenceId)).size, 3, "Units must be distinct");

  for (const player of personas) {
    const another = personas.find((other) => other.alias !== player.alias)!;
    const deniedDashboard = await api(
      "/v1/persistent-world/dashboard?actorId=" + another.actorId,
      player.cookie,
    );
    assert.equal(deniedDashboard.response.status, 403, "Cross-account dashboard leaked");
    const deniedAct = await api("/v1/persistent-world/actions", player.cookie, {
      method: "POST",
      headers: { "idempotency-key": "ci-story-forged-" + randomUUID() },
      body: JSON.stringify({ actorId: another.actorId, command: "Do one push up." }),
    });
    assert.equal(deniedAct.response.status, 403, "Cross-account action was not blocked");
  }

  const results: Array<{ persona: Persona; text: string; key: string; response: any }> = [];
  for (const player of personas) {
    for (const [index, text] of ["Do one push up.", "Stand up."].entries()) {
      const key = "ci-story-" + storyId + "-" + player.alias + "-" + index;
      results.push({ persona: player, text, key, response: await submit(player, text, key) });
    }
    const original = results.find((r) => r.persona.userId === player.userId)!;
    const replay = await submit(player, original.text, original.key);
    assert.equal(replay.requestId, original.response.requestId, "Replay duplicated the request");
    assert.deepEqual(replay.eventIds, original.response.eventIds, "Replay duplicated events");
  }

  const users = personas.map((p) => p.userId);
  const requestIds = results.map((r) => r.response.requestId);
  const rows = await db.client.unsafe<
    Array<{
      request_id: string;
      user_id: string;
      actor_id: string;
      status: string;
      command: string;
      plan_id: string | null;
      player_safe_result: { narration?: string; eventIds?: string[] } | null;
    }>
  >(
    "SELECT request_id, user_id, actor_id, status, command, plan_id, player_safe_result " +
      "FROM game.world_action_requests WHERE request_id = ANY($1::uuid[])",
    [requestIds],
  );
  assert.equal(rows.length, 6, "Exactly six unique durable requests must exist");
  const byRequest = new Map(rows.map((r) => [r.request_id, r]));
  const eventIds = results.flatMap((r) => r.response.eventIds as string[]);
  const events = await db.client.unsafe<Array<{ event_id: string; world_id: string }>>(
    "SELECT event_id, world_id FROM game.event_ledger WHERE event_id = ANY($1::uuid[])",
    [eventIds],
  );
  const receipts = await db.client.unsafe<
    Array<{ event_id: string; actor_id: string; world_id: string; shard_id: string }>
  >(
    "SELECT event_id, actor_id, world_id, shard_id FROM game.mutation_receipts " +
      "WHERE event_id = ANY($1::uuid[])",
    [eventIds],
  );
  assert.equal(events.length, 6, "Each unique completed action needs an event");
  assert.equal(receipts.length, 6, "Each unique completed action needs a receipt");
  const eventById = new Map(events.map((e) => [e.event_id, e]));
  const receiptByEvent = new Map(receipts.map((r) => [r.event_id, r]));
  for (const result of results) {
    const row = byRequest.get(result.response.requestId);
    assert.ok(row, "Request absent from PostgreSQL");
    assert.equal(row.user_id, result.persona.userId, "Actor/account attribution mismatch");
    assert.equal(row.actor_id, result.persona.actorId, "Wrong player character recorded");
    assert.equal(row.status, "completed");
    assert.equal(row.command, result.text);
    assert.equal(row.plan_id, result.response.plan.planId);
    assert.ok(row.player_safe_result?.narration, "Persisted narration is missing");
    assert.deepEqual(row.player_safe_result?.eventIds, result.response.eventIds);
    for (const id of result.response.eventIds) {
      assert.ok(eventById.has(id), "Exposed event absent from durable ledger");
      assert.equal(
        receiptByEvent.get(id)?.actor_id,
        result.persona.actorId,
        "Committed receipt belongs to another player",
      );
    }
    const scene = await ok("/v1/persistent-world/scene", result.persona.cookie);
    assert.equal(scene.actorId, result.persona.actorId);
  }

  await mkdir("artifacts", { recursive: true });
  const report = {
    type: "real-three-account-deterministic-provider-smoke",
    status: "passed",
    storyId,
    accountCount: 3,
    uniqueRequests: rows.length,
    events: events.length,
    receipts: receipts.length,
    crossAccountActionDenials: 3,
    crossAccountDashboardDenials: 3,
    replayChecks: 3,
    actors: personas.map((p) => ({
      alias: p.alias,
      actorId: p.actorId,
      residenceId: p.residenceId,
      requestIds: results.filter((r) => r.persona.actorId === p.actorId).map((r) => r.response.requestId),
    })),
    limitation: "CI uses deterministic fake Jev/Laguna; this is not 72-beat live story certification.",
  };
  await writeFile("artifacts/real-multi-user-story.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

try {
  await main();
} finally {
  await db.close();
  await closeAuthFromEnv();
}
