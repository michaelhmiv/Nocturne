/**
 * A genuine three-identity HTTP/PostgreSQL test of the current action engine.
 * Uses the disposable CI database and fake provider, NOT production or live AI.
 * This is the first executable story slice, not the 72-turn live story runner.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  createAgentStore,
  createDatabase,
  DEFAULT_WORLD_ID,
  DEFAULT_SHARD_ID,
} from "../../packages/database/src/index.js";

const databaseUrl = process.env.DATABASE_URL || "postgres://invalid:invalid@invalid/invalid";
const apiUrl = process.env.NOCTURNE_API_URL || "https://invalid";
const providerUrl = process.env.AI_DECISION_ENDPOINT || "https://invalid";
const databaseAddress = new URL(databaseUrl);
const apiAddress = new URL(apiUrl);
const providerAddress = new URL(providerUrl);
assert.equal(process.env.NOCTURNE_STORY_SANDBOX, "1", "Explicit sandbox flag required.");
assert.ok(
  ["localhost", "127.0.0.1"].includes(databaseAddress.hostname),
  "Refusing remote database.",
);
assert.equal(
  databaseAddress.pathname,
  "/nocturne_integration",
  "Refusing non-disposable database.",
);
assert.ok(["localhost", "127.0.0.1"].includes(apiAddress.hostname), "Refusing remote API.");
assert.ok(["localhost", "127.0.0.1"].includes(providerAddress.hostname), "Refusing live AI.");
assert.ok(
  providerAddress.pathname.endsWith("/api/alpha/decisions"),
  "Fake Decisions endpoint required.",
);

const db = createDatabase(databaseUrl);
const agents = createAgentStore(db);
const runId = randomUUID();
const players = [
  { alias: "mara", name: "Mara Velez" },
  { alias: "dax", name: "Dax Mercer" },
  { alias: "imani", name: "Imani Brooks" },
];
const turns = [];

async function query(sql, values = []) {
  return db.client.unsafe(sql, values);
}

async function api(player, path, method = "GET", body, key) {
  const response = await fetch(apiUrl + path, {
    method,
    headers: {
      authorization: "Bearer " + player.token,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await response.text();
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    throw new Error(path + " returned non-JSON: " + response.status + " " + raw.slice(0, 300));
  }
  return { status: response.status, result };
}

async function ok(player, path, method, body, key) {
  const reply = await api(player, path, method, body, key);
  assert.ok(reply.status >= 200 && reply.status < 300, path + ": " + JSON.stringify(reply.result));
  return reply.result;
}

async function actorState(id) {
  const [actor] = await query(
    "SELECT instance_id, world_id, shard_id, version::text, condition, state, location_id FROM game.entity_instances WHERE instance_id = $1",
    [id],
  );
  assert.ok(actor, "No persistent actor.");
  return actor;
}

async function play(player, chapter) {
  const command = "Do one push-up.";
  const key = "story-ci-action:" + runId + ":" + player.alias + ":" + chapter;
  const before = await actorState(player.actorId);
  const outcome = await ok(
    player,
    "/v1/persistent-world/actions",
    "POST",
    { actorId: player.actorId, command },
    key,
  );
  assert.equal(outcome.state, "completed", "Routine action must terminate.");
  assert.ok(outcome.requestId, "No request ID.");
  const [record] = await query(
    "SELECT request_id, user_id, actor_id, world_id, shard_id, command, status, plan_id, player_safe_result, completed_at FROM game.world_action_requests WHERE request_id = $1",
    [outcome.requestId],
  );
  assert.ok(record && record.plan_id, "Action request or plan missing.");
  assert.equal(record.user_id, player.userId);
  assert.equal(record.actor_id, player.actorId);
  assert.equal(record.world_id, DEFAULT_WORLD_ID);
  assert.equal(record.shard_id, DEFAULT_SHARD_ID);
  assert.equal(record.status, "completed");
  assert.equal(record.command, command);
  assert.ok(record.completed_at && record.player_safe_result, "Incomplete persisted result.");
  const steps = await query(
    "SELECT step_id, status, result_event_id, result_receipt_id FROM game.action_plan_steps WHERE plan_id = $1 ORDER BY step_order",
    [record.plan_id],
  );
  assert.ok(
    steps.length && steps.every((step) => step.status === "completed"),
    "Nonterminal plan.",
  );
  assert.ok(steps[0].result_event_id, "Completed action lacks event.");
  const [event] = await query(
    "SELECT event_id, event_type, world_id, shard_id, involved_entity_ids FROM game.event_ledger WHERE event_id = $1",
    [steps[0].result_event_id],
  );
  assert.ok(event, "Append-only event missing.");
  assert.equal(event.world_id, DEFAULT_WORLD_ID);
  assert.equal(event.shard_id, DEFAULT_SHARD_ID);
  assert.ok(event.involved_entity_ids.includes(player.actorId), "Event has wrong actor.");
  const stages = await query(
    "SELECT stage_type, status FROM game.world_action_execution_stages WHERE request_id = $1 ORDER BY stage_order",
    [record.request_id],
  );
  assert.ok(stages.length > 0, "Execution stages were not logged.");
  const after = await actorState(player.actorId);
  assert.deepEqual(
    [after.version, after.condition, after.state, after.location_id],
    [before.version, before.condition, before.state, before.location_id],
    "Routine exercise altered authoritative actor state.",
  );
  const narration =
    outcome.narration ||
    outcome.plan?.narration ||
    outcome.prompt ||
    record.player_safe_result.narration;
  assert.ok(typeof narration === "string" && narration.trim(), "Action has no narration.");
  return {
    chapter,
    alias: player.alias,
    userId: player.userId,
    actorId: player.actorId,
    command,
    idempotencyKey: key,
    requestId: record.request_id,
    planId: record.plan_id,
    eventId: event.event_id,
    eventType: event.event_type,
    receiptId: steps[0].result_receipt_id,
    stageTypes: stages.map((stage) => stage.stage_type + ":" + stage.status),
    narration,
  };
}

try {
  for (const player of players) {
    player.userId = "story-ci:" + runId + ":" + player.alias;
    const token = await agents.createToken({
      userId: player.userId,
      label: "story-" + player.alias,
      scopes: ["play", "character:read", "character:write", "action:submit"],
    });
    player.token = token.token; // Deliberately excluded from all results and logs.
    const created = await ok(
      player,
      "/v1/characters",
      "POST",
      {
        name: player.name,
        conceptSummary: "An original fictional tenant for multiplayer CI certification.",
        originSource: "ci",
        qualities: {},
      },
      "story-ci-character:" + runId + ":" + player.alias,
    );
    player.actorId = created.characterId;
    assert.ok(player.actorId, "Character creation returned no ID.");
    await ok(player, "/v1/characters/" + player.actorId + "/select", "POST", {});
    const rent = await ok(
      player,
      "/v1/residences/starter/rent",
      "POST",
      {
        characterId: player.actorId,
      },
      "story-ci-residence:" + runId + ":" + player.alias,
    );
    player.residenceId = rent.residenceId;
    assert.ok(player.residenceId, "Starter apartment missing.");
    const dashboard = await ok(player, "/v1/persistent-world/dashboard");
    assert.equal((dashboard.dashboard || dashboard).character.characterId, player.actorId);
    assert.equal((dashboard.dashboard || dashboard).character.residenceId, player.residenceId);
  }

  for (const property of ["token", "userId", "actorId", "residenceId"]) {
    assert.equal(
      new Set(players.map((player) => player[property])).size,
      3,
      property + " collision.",
    );
  }

  // Independent credentials and alternating players, not one impersonated test user.
  for (let chapter = 0; chapter < 2; chapter += 1) {
    for (const player of players) turns.push(await play(player, chapter));
  }
  assert.equal(turns.length, 6, "Skipped story beat.");
  assert.equal(new Set(turns.map((turn) => turn.requestId)).size, 6, "Request collision.");
  assert.equal(new Set(turns.map((turn) => turn.eventId)).size, 6, "Event collision.");

  const first = turns[0];
  const replay = await ok(
    players[0],
    "/v1/persistent-world/actions",
    "POST",
    {
      actorId: first.actorId,
      command: first.command,
    },
    first.idempotencyKey,
  );
  assert.equal(replay.requestId, first.requestId, "Replay created another request.");
  const originalEvents = await query("SELECT event_id FROM game.event_ledger WHERE event_id = $1", [
    first.eventId,
  ]);
  assert.equal(originalEvents.length, 1, "Replay duplicated the event.");

  const forbiddenKey = "story-ci-cross-account:" + runId;
  const forbidden = await api(
    players[1],
    "/v1/persistent-world/actions",
    "POST",
    {
      actorId: players[0].actorId,
      command: "Do one push-up.",
    },
    forbiddenKey,
  );
  assert.equal(forbidden.status, 403, "Acting as another player was not rejected.");
  assert.equal(
    (
      await query("SELECT request_id FROM game.world_action_requests WHERE idempotency_key = $1", [
        forbiddenKey,
      ])
    ).length,
    0,
    "Forbidden action created a request.",
  );

  for (const player of players) {
    const dashboard = await ok(player, "/v1/persistent-world/dashboard");
    assert.equal((dashboard.dashboard || dashboard).character.characterId, player.actorId);
    const other = players.find((candidate) => candidate.actorId !== player.actorId);
    const hidden = await api(player, "/v1/persistent-world/dashboard?actorId=" + other.actorId);
    assert.equal(hidden.status, 403, "Another player's dashboard was exposed.");
  }

  // Fourth independent credential: an offline-bound certification principal
  // must be routed to its isolated world and must not create public housing
  // through historical /v1/characters or /v1/residences/starter/rent.
  const certificationWorld = randomUUID();
  const certificationShard = randomUUID();
  const certificationRun = randomUUID();
  const certificationUser = "story-ci-certification:" + runId;
  const certificate = await agents.createToken({
    userId: certificationUser,
    label: "story-certification-isolated",
    scopes: ["play", "character:read", "character:write", "action:submit"],
  });
  const certificationPlayer = { token: certificate.token };
  await query(
    "INSERT INTO game.worlds(world_id,slug,name,metadata) VALUES ($1,$2,'CI certificate world',$3::jsonb)",
    [
      certificationWorld,
      "ci-certificate-" + certificationRun,
      JSON.stringify({ isolatedCertification: true }),
    ],
  );
  await query(
    "INSERT INTO game.world_shards(shard_id,world_id,slug,name) VALUES ($1,$2,'primary','Primary')",
    [certificationShard, certificationWorld],
  );
  await query(
    "INSERT INTO game.certification_runs(run_id,world_id,shard_id,expires_at) VALUES ($1,$2,$3,now()+interval '30 minutes')",
    [certificationRun, certificationWorld, certificationShard],
  );
  await query(
    "INSERT INTO game.certification_players(run_id,user_id,world_id,shard_id) VALUES ($1,$2,$3,$4)",
    [certificationRun, certificationUser, certificationWorld, certificationShard],
  );
  await query(
    "INSERT INTO game.world_memberships(world_id,user_id,role,status) VALUES ($1,$2,'player','active')",
    [certificationWorld, certificationUser],
  );
  const blockedCreate = await api(
    certificationPlayer,
    "/v1/characters",
    "POST",
    { name: "Must Not Spawn in Production", conceptSummary: "Isolated certification" },
    "ci-certification-blocked-create:" + runId,
  );
  assert.equal(blockedCreate.status, 403, "Certification account wrote shared-world character.");
  const blockedList = await api(certificationPlayer, "/v1/characters");
  assert.equal(blockedList.status, 403, "Certification account listed public-world characters.");
  const publicMembership = await query(
    "SELECT 1 FROM game.world_memberships WHERE user_id=$1 AND world_id=$2",
    [certificationUser, DEFAULT_WORLD_ID],
  );
  assert.equal(publicMembership.length, 0, "Certification account joined public world.");
  const publicCharacters = await query(
    "SELECT 1 FROM game.player_characters WHERE user_id=$1 AND world_id=$2",
    [certificationUser, DEFAULT_WORLD_ID],
  );
  assert.equal(publicCharacters.length, 0, "Certification account created public actor.");

  // Three MORE independent normal player credentials, this time inside one
  // genuinely isolated certification world. SQL fixture setup remains
  // operator-controlled, never available as an HTTP/MCP mutation.
  const certifiedPlayers = [
    {
      alias: "mara",
      name: "Mara Velez",
      userId: certificationUser,
      token: certificationPlayer.token,
    },
  ];
  for (const identity of [
    { alias: "dax", name: "Dax Mercer" },
    { alias: "imani", name: "Imani Brooks" },
  ]) {
    const userId = "story-ci-certification:" + runId + ":" + identity.alias;
    const minted = await agents.createToken({
      userId,
      label: "isolated-" + identity.alias,
      scopes: ["play", "character:read", "character:write", "action:submit"],
    });
    await query(
      "INSERT INTO game.certification_players(run_id,user_id,world_id,shard_id) VALUES ($1,$2,$3,$4)",
      [certificationRun, userId, certificationWorld, certificationShard],
    );
    await query(
      "INSERT INTO game.world_memberships(world_id,user_id,role,status) VALUES ($1,$2,'player','active')",
      [certificationWorld, userId],
    );
    certifiedPlayers.push({ ...identity, userId, token: minted.token });
  }
  const [certDistrict] = await query(
    "SELECT game.provision_certification_district($1) AS district",
    [certificationRun],
  );
  assert.equal(certDistrict.district.worldId, certificationWorld);
  const certifiedTurns = [];
  for (const player of certifiedPlayers) {
    const [provisioned] = await query(
      "SELECT * FROM game.provision_certification_player($1,$2,$3)",
      [certificationRun, player.userId, player.name],
    );
    assert.ok(provisioned.actor_id && provisioned.residence_id);
    assert.equal(provisioned.already_provisioned, false);
    const dashboard = await ok(player, "/v1/persistent-world/dashboard");
    assert.equal(
      (dashboard.dashboard || dashboard).character.characterId,
      provisioned.actor_id,
      "Bound player did not see their own isolated character.",
    );
    const key = "story-ci-isolated:" + runId + ":" + player.alias;
    const command = "Do one push-up.";
    const before = await actorState(provisioned.actor_id);
    const outcome = await ok(
      player,
      "/v1/persistent-world/actions",
      "POST",
      { actorId: provisioned.actor_id, command },
      key,
    );
    assert.equal(outcome.state, "completed", "Isolated routine action did not finish.");
    const [record] = await query(
      "SELECT request_id,world_id,shard_id,user_id,actor_id,plan_id,status,player_safe_result FROM game.world_action_requests WHERE request_id=$1",
      [outcome.requestId],
    );
    assert.ok(record?.plan_id && record.player_safe_result);
    assert.equal(record.world_id, certificationWorld);
    assert.equal(record.shard_id, certificationShard);
    assert.equal(record.user_id, player.userId);
    assert.equal(record.actor_id, provisioned.actor_id);
    assert.equal(record.status, "completed");
    const steps = await query(
      "SELECT result_event_id FROM game.action_plan_steps WHERE plan_id=$1",
      [record.plan_id],
    );
    assert.ok(steps.length && steps[0].result_event_id, "Isolated plan lacks event.");
    const [event] = await query(
      "SELECT event_id,world_id,shard_id,involved_entity_ids FROM game.event_ledger WHERE event_id=$1",
      [steps[0].result_event_id],
    );
    assert.ok(event && event.involved_entity_ids.includes(provisioned.actor_id));
    assert.equal(event.world_id, certificationWorld);
    assert.equal(event.shard_id, certificationShard);
    const after = await actorState(provisioned.actor_id);
    assert.equal(after.world_id, certificationWorld);
    assert.equal(after.shard_id, certificationShard);
    assert.deepEqual(
      [after.version, after.location_id, after.condition],
      [before.version, before.location_id, before.condition],
      "Nonmutating isolated exercise changed authoritative state.",
    );
    certifiedTurns.push({
      alias: player.alias,
      userId: player.userId,
      actorId: provisioned.actor_id,
      residenceId: provisioned.residence_id,
      requestId: record.request_id,
      eventId: event.event_id,
      worldId: record.world_id,
      shardId: record.shard_id,
    });
  }
  assert.equal(new Set(certifiedTurns.map((turn) => turn.actorId)).size, 3);
  assert.equal(new Set(certifiedTurns.map((turn) => turn.residenceId)).size, 3);
  assert.equal(new Set(certifiedTurns.map((turn) => turn.eventId)).size, 3);
  const impersonation = await api(
    certifiedPlayers[0],
    "/v1/persistent-world/actions",
    "POST",
    { actorId: certifiedTurns[1].actorId, command: "Do one push-up." },
    "story-ci-isolated-impersonation:" + runId,
  );
  assert.equal(impersonation.status, 403, "Isolated players may not impersonate each other.");
  const crossed = await api(
    certifiedPlayers[0],
    "/v1/persistent-world/actions",
    "POST",
    { actorId: players[0].actorId, command: "Do one push-up." },
    "story-ci-isolated-cross-world:" + runId,
  );
  assert.equal(crossed.status, 403, "Isolated players may not act in public world.");
  await query(
    "UPDATE game.certification_runs SET status='revoked' WHERE run_id=$1",
    [certificationRun],
  );
  const revoked = await api(certifiedPlayers[0], "/v1/persistent-world/dashboard");
  assert.equal(revoked.status, 403, "Revoked player must never fall back to public world.");
  const noPublic = await query(
    "SELECT user_id FROM game.world_memberships WHERE world_id=$1 AND user_id=ANY($2::text[])",
    [DEFAULT_WORLD_ID, certifiedPlayers.map((player) => player.userId)],
  );
  assert.equal(noPublic.length, 0, "Isolated players acquired public membership.");

  const report = {
    status: "passed",
    stage: "real-api-postgres-fake-provider",
    liveModel: false,
    production: false,
    runId,
    worldId: DEFAULT_WORLD_ID,
    shardId: DEFAULT_SHARD_ID,
    players: players.map(({ alias, userId, actorId, residenceId }) => ({
      alias,
      userId,
      actorId,
      residenceId,
    })),
    turns,
    independentCredentials: true,
    crossAccountActionDenied: true,
    crossAccountDashboardDenied: true,
    idempotentReplay: true,
    isolatedCertification: {
      worldId: certificationWorld,
      shardId: certificationShard,
      district: certDistrict.district,
      turns: certifiedTurns,
      crossActorDenied: true,
      crossWorldDenied: true,
      revokedRunDenied: true,
    },
  };
  await writeFile("artifacts/multiplayer-story-slice.json", JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      status: report.status,
      stage: report.stage,
      players: report.players.length,
      beats: turns.length,
      events: turns.map((turn) => turn.eventId),
      crossAccountActionDenied: true,
      idempotentReplay: true,
    }),
  );
} finally {
  await db.close();
}
