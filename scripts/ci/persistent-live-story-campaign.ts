/**
 * Persistent Jev + Laguna gameplay on a pinned Railway Testing PostgreSQL world.
 *
 * Unlike the static story corpus and fake-provider six-turn slice, this runner
 * sends actual natural language through the compiled API to OpenRouter Jev
 * and Laguna. Every authored beat is attempted, even after an earlier failure.
 * It NEVER claims story certification: domain-specific probes, real OAuth/MCP,
 * persistent production deployment, and human prose review remain separate.
 *
 * Never run against production or an unpinned endpoint; retain all game state and failures.
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { STORY_CERTIFICATION_CASES } from "./story-certification-corpus.mjs";
import {
  generateSignalGardenCampaign,
  auditSignalGardenCampaign,
} from "./signal-garden-campaign.js";
import {
  createAgentStore,
  createDatabase,
  DEFAULT_WORLD_ID,
} from "../../packages/database/src/index.js";

const databaseUrl = process.env.DATABASE_URL || "postgres://invalid:invalid@invalid/invalid";
const apiUrl = process.env.NOCTURNE_API_URL || "https://invalid";
const decisionUrl = process.env.AI_DECISION_ENDPOINT || "https://invalid";
const narrationModel = process.env.AI_NARRATION_MODEL || "";
const decisionModel = process.env.AI_DECISION_MODEL || "";
const dbAddress = new URL(databaseUrl);
const apiAddress = new URL(apiUrl);
const modelAddress = new URL(decisionUrl);
assert.equal(process.env.NOCTURNE_LIVE_STORY_SANDBOX, "1", "Live sandbox opt-in required.");
assert.ok(
  !["127.0.0.1", "localhost"].includes(dbAddress.hostname),
  "Require pinned public Testing database.",
);
assert.ok(
  !dbAddress.hostname.endsWith(".railway.internal"),
  "Private Railway URL forbidden in GitHub Actions.",
);
assert.equal(
  createHash("sha256")
    .update(dbAddress.hostname + ":" + dbAddress.port)
    .digest("hex")
    .slice(0, 16),
  "545485b0dba3929f",
  "Refusing to mutate a database other than the user-attested Railway Testing endpoint.",
);
assert.ok(["127.0.0.1", "localhost"].includes(apiAddress.hostname), "Remote API forbidden.");
assert.equal(
  modelAddress.origin,
  "https://openrouter.ai",
  "Real OpenRouter Jev endpoint required.",
);
assert.equal(modelAddress.pathname, "/api/alpha/decisions", "Jev Decisions API required.");
assert.equal(decisionModel, "~typesafe/jev-latest", "Expected Jev latest.");
assert.equal(narrationModel, "poolside/laguna-xs-2.1", "Expected Laguna XS narrator.");
assert.ok(process.env.OPENROUTER_API_KEY, "Live model credentials are missing.");

const db = createDatabase(databaseUrl);
const agents = createAgentStore(db);
let runId = randomUUID();
let worldId = randomUUID();
let shardId = randomUUID();
let cursor = 0;
let previousFailures = 0;
const campaignSlug = "persistent-jev-laguna-5000-v1";
const allBeats = STORY_CERTIFICATION_CASES.flatMap((story) =>
  story.acts.flatMap((act) =>
    act.beats.map((beat) => ({
      ...beat,
      storyId: story.id,
      storyTitle: story.title,
      actId: act.id,
      sceneSetup: act.setup,
    })),
  ),
);
const garden = generateSignalGardenCampaign({ turns: 5000 - allBeats.length });
const gardenAudit = auditSignalGardenCampaign(garden);
assert.deepEqual(
  gardenAudit.errors,
  [],
  "The generated campaign must use distinct commands across all 25 action types and all three players.",
);
allBeats.push(
  ...garden.map((turn) => ({
    id: "signal-garden-" + String(turn.sequence + 1).padStart(4, "0"),
    actor: turn.playerAlias,
    text: turn.command,
    storyId: "signal-garden",
    storyTitle: "Signal Garden / real-provider endurance",
    actId: "chapter-" + turn.chapter,
    sceneSetup:
      "Continue the established persistent city from prior actions, with packet " +
      turn.packetId +
      ".",
    checks: [turn.actionType, turn.expectedWorldKind],
    clock: null,
  })),
);
assert.equal(
  allBeats.length,
  5000,
  "The enduring campaign must have 5000 authored or distinct generated commands.",
);
const limit = Number(process.env.PERSISTENT_STORY_BATCH || "72");
assert.ok(
  Number.isInteger(limit) && limit >= 1 && limit <= 250,
  "Batch must be 1–250 real-provider turns.",
);
let beats = [];
const players = [
  { alias: "mara", name: "Mara Velez" },
  { alias: "dax", name: "Dax Mercer" },
  { alias: "imani", name: "Imani Brooks" },
];
const turns = [];
const firstByBeatId = new Map();
const startedAt = new Date();
let completedSetup = false;
let infrastructureError = null;
let crossAccountDenied = false;
let revokedDenied = false;

async function query(sql, values = []) {
  return db.client.unsafe(sql, values);
}
function safeError(err) {
  const text = String(err instanceof Error ? err.message : err);
  return text
    .replace(/noct_agt_[A-Za-z0-9_-]+/g, "[REDACTED-AGENT]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED-KEY]")
    .replace(/postgres\S+/gi, "[REDACTED-DATABASE-URL]")
    .slice(0, 900);
}
async function send(player, path, method = "GET", body, key) {
  const resp = await fetch(apiUrl + path, {
    method,
    headers: {
      authorization: "Bearer " + player.token,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(115000),
  });
  const raw = await resp.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = { invalidJson: true, excerpt: raw.slice(0, 300) };
  }
  return { status: resp.status, data };
}
async function snapshot(actorId) {
  const [actor] = await query(
    "SELECT instance_id,world_id,shard_id,version::text,location_id,condition,state FROM game.entity_instances WHERE instance_id=$1",
    [actorId],
  );
  assert.ok(actor, "Actor is missing.");
  assert.equal(actor.world_id, worldId);
  assert.equal(actor.shard_id, shardId);
  return {
    actorId: actor.instance_id,
    version: actor.version,
    locationId: actor.location_id,
    condition: actor.condition,
    state: actor.state,
  };
}
function narrationFrom(data, record) {
  const values = [
    data?.narration,
    data?.prompt,
    data?.message,
    data?.plan?.narration,
    data?.result?.narration,
    record?.player_safe_result?.narration,
    record?.player_safe_result?.text,
  ];
  return values.find((text) => typeof text === "string" && text.trim()) || "";
}
function materialStateChanged(before, after) {
  return (
    JSON.stringify({
      locationId: before?.locationId,
      condition: before?.condition,
      state: before?.state,
    }) !==
    JSON.stringify({
      locationId: after?.locationId,
      condition: after?.condition,
      state: after?.state,
    })
  );
}
async function durableEvidence(requestId) {
  if (!requestId) return { request: null, steps: [], events: [], stages: [] };
  const [request] = await query(
    "SELECT request_id,user_id,actor_id,world_id,shard_id,status,command,plan_id,player_safe_result,completed_at FROM game.world_action_requests WHERE request_id=$1 AND world_id=$2 AND shard_id=$3",
    [requestId, worldId, shardId],
  );
  const steps = request?.plan_id
    ? await query(
        "SELECT step_id,step_order,status,result_event_id,result_receipt_id FROM game.action_plan_steps WHERE plan_id=$1 ORDER BY step_order",
        [request.plan_id],
      )
    : [];
  const ids = steps.map((s) => s.result_event_id).filter(Boolean);
  const events = ids.length
    ? await query(
        "SELECT event_id,world_id,shard_id,event_type,involved_entity_ids,payload FROM game.event_ledger WHERE event_id=ANY($1::uuid[]) ORDER BY world_time",
        [ids],
      )
    : [];
  const stages = await query(
    "SELECT stage_type,status FROM game.world_action_execution_stages WHERE request_id=$1 ORDER BY stage_order",
    [requestId],
  );
  return { request: request || null, steps, events, stages };
}
async function runBeat(beat, index) {
  const player = players.find((p) => p.alias === beat.actor);
  assert.ok(player, "Story actor does not exist.");
  const previous = beat.sameKeyAs ? firstByBeatId.get(beat.sameKeyAs) : null;
  const command = previous?.executedCommand || beat.text;
  const key = previous?.idempotencyKey || "live-story:" + runId + ":" + beat.id;
  const started = Date.now();
  const before = await snapshot(player.actorId);
  const dialogueTarget =
    beat.id === "keys-10"
      ? players.find((candidate) => candidate.alias === "dax")
      : beat.id === "keys-11"
        ? players.find((candidate) => candidate.alias === "mara")
        : null;
  const targetBefore = dialogueTarget?.actorId ? await snapshot(dialogueTarget.actorId) : null;
  let response = null;
  let transportError = null;
  try {
    response = await send(
      player,
      "/v1/persistent-world/actions",
      "POST",
      {
        actorId: player.actorId,
        command,
      },
      key,
    );
  } catch (err) {
    transportError = safeError(err);
  }
  const requestId = response?.data?.requestId || response?.data?.plan?.requestId || null;
  let evidence = await durableEvidence(requestId);
  const initialStatus = evidence.request?.status || response?.data?.state || null;
  // An actual timed wait must not be certified as synchronous completion.
  // Poll the existing request, NOT a new submission, for up to three minutes.
  if (beat.clock === "real" && ["waiting", "waiting_for_time"].includes(initialStatus)) {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      evidence = await durableEvidence(requestId);
      if (["completed", "failed", "cancelled"].includes(evidence.request?.status)) break;
    }
  }
  const after = await snapshot(player.actorId);
  let dashboard = null;
  let dashboardError = null;
  try {
    const answer = await send(player, "/v1/persistent-world/dashboard");
    dashboard = answer.status === 200 ? answer.data?.dashboard || answer.data : null;
    if (!dashboard) dashboardError = "dashboard_http_" + answer.status;
  } catch (err) {
    dashboardError = safeError(err);
  }
  const elapsedMs = Date.now() - started;
  const record = evidence.request;
  const scopeCorrect = Boolean(
    record &&
    record.user_id === player.userId &&
    record.actor_id === player.actorId &&
    record.world_id === worldId &&
    record.shard_id === shardId,
  );
  const durableEventsLinked =
    evidence.events.every(
      (event) =>
        event.world_id === worldId &&
        event.shard_id === shardId &&
        event.involved_entity_ids?.includes(player.actorId),
    ) && evidence.events.length === evidence.steps.filter((s) => s.result_event_id).length;
  const ownDashboard = dashboard?.character?.characterId === player.actorId;
  const narration = narrationFrom(response?.data, record);
  const observedDefects = [];
  if (transportError) observedDefects.push("transport_error");
  if (!response || response.status >= 500) observedDefects.push("server_or_provider_failure");
  if (response && response.status >= 400 && response.status < 500) {
    observedDefects.push("player_action_rejected");
  }
  if (requestId && !record) observedDefects.push("missing_authoritative_request");
  if (record && !scopeCorrect) observedDefects.push("request_scope_mismatch");
  if (record && !durableEventsLinked) observedDefects.push("event_scope_or_link_mismatch");
  if (!ownDashboard) observedDefects.push("player_dashboard_missing_or_wrong");
  if (!narration) observedDefects.push("narration_missing");
  // Required ordinary objectives are not certified merely because the API
  // returned 200, wrote a failure event, or generated convincing prose.
  const positiveObjectives = new Set([
    "keys-01",
    "keys-02",
    "keys-06",
    "keys-07",
    "keys-08",
    "keys-09",
    "keys-12",
  ]);
  if (positiveObjectives.has(beat.id)) {
    if (!record || record.status !== "completed") {
      observedDefects.push("positive_objective_not_completed");
    }
    if (
      /\\b(?:do not accomplish|did not accomplish|cannot quite determine|no matching source|no effect)\\b/i.test(
        narration,
      )
    ) {
      observedDefects.push("positive_objective_failed_in_narration");
    }
    if (evidence.events.length === 0) observedDefects.push("positive_objective_has_no_event");
    if (["keys-07", "keys-08"].includes(beat.id) && before?.locationId === after?.locationId) {
      observedDefects.push("move_did_not_change_durable_location");
    }
    if (beat.id === "keys-09" && !materialStateChanged(before, after)) {
      observedDefects.push("preference_not_persisted");
    }
    if (
      beat.id === "keys-01" &&
      /(?:promising lead|fragment of evidence|matching signature)/i.test(narration)
    ) {
      observedDefects.push("scene_observation_is_generic_invented_clue");
    }
  }
  if (
    dialogueTarget &&
    before?.locationId !== targetBefore?.locationId &&
    /(?:introduce|make your way over|ask|accomplish your objective|spot .* near)/i.test(narration)
  ) {
    observedDefects.push("dialogue_claims_remote_player_is_present");
  }

  if (beat.clock === "real" && ["waiting", "waiting_for_time"].includes(record?.status)) {
    observedDefects.push("real_timed_action_not_terminal_after_180_seconds");
  }
  if (
    beat.clock === "real" &&
    record?.status === "completed" &&
    elapsedMs < 120000 &&
    /\btwo minutes\b/i.test(beat.text)
  )
    observedDefects.push("two_minute_task_completed_too_soon");
  const result = {
    beatId: beat.id,
    index: index + 1,
    storyId: beat.storyId,
    storyTitle: beat.storyTitle,
    actId: beat.actId,
    sceneSetup: beat.sceneSetup,
    actor: player.alias,
    userId: player.userId,
    actorId: player.actorId,
    originalStoryCommand: beat.text,
    executedCommand: command,
    idempotencyKey: key,
    sameKeyAs: beat.sameKeyAs || null,
    checksRequired: beat.checks,
    clock: beat.clock || null,
    httpStatus: response?.status ?? null,
    engineState: response?.data?.state || null,
    requestId,
    durableRequestStatus: record?.status || null,
    planId: record?.plan_id || null,
    steps: evidence.steps.map((s) => ({
      stepId: s.step_id,
      status: s.status,
      eventId: s.result_event_id,
      receiptId: s.result_receipt_id,
    })),
    events: evidence.events.map((event) => ({
      eventId: event.event_id,
      eventType: event.event_type,
      worldId: event.world_id,
      shardId: event.shard_id,
      involvedEntityIds: event.involved_entity_ids,
      payload: event.payload,
    })),
    stages: evidence.stages.map((s) => ({ stage: s.stage_type, status: s.status })),
    before,
    after,
    materialStateChanged: materialStateChanged(before, after),
    ownDashboard,
    dashboardError,
    narration: narration.slice(0, 12000),
    elapsedMs,
    scopeCorrect,
    durableEventsLinked,
    observedDefects,
    transportError,
    verdict: observedDefects.length
      ? "observed_failure"
      : "executed_requires_domain_and_narration_review",
  };
  firstByBeatId.set(beat.id, result);
  return result;
}

try {
  const [existing] = await query(
    "SELECT world_id, metadata FROM game.worlds WHERE slug=$1 LIMIT 1",
    [campaignSlug],
  );
  if (existing) {
    assert.equal(
      existing.metadata?.isolatedCertification,
      true,
      "Persistent campaign lost isolation marker.",
    );
    const [prior] = await query(
      "SELECT run_id,shard_id,status,campaign_mode FROM game.certification_runs WHERE world_id=$1 LIMIT 1",
      [existing.world_id],
    );
    worldId = existing.world_id;
    if (prior) {
      assert.equal(prior.status, "active", "Do not reuse a revoked certification world.");
      assert.equal(
        prior.campaign_mode,
        "persistent",
        "This is not a persistent certification run.",
      );
      runId = prior.run_id;
      shardId = prior.shard_id;
    } else {
      // A prior failed bootstrap may have committed an isolated empty world and
      // shard before the old expiry constraint rejected its certification run.
      // Recover ONLY that known-empty, explicitly marked campaign. Never
      // attach a new certification run to a world containing player data.
      const [orphan] = await query(
        "SELECT (SELECT count(*)::int FROM game.entity_instances WHERE world_id=$1) AS entities, (SELECT count(*)::int FROM game.event_ledger WHERE world_id=$1) AS events",
        [worldId],
      );
      assert.equal(orphan?.entities, 0, "Unsafe recovery: orphan world already has entities.");
      assert.equal(orphan?.events, 0, "Unsafe recovery: orphan world already has events.");
      const [onlyShard] = await query("SELECT shard_id FROM game.world_shards WHERE world_id=$1", [
        worldId,
      ]);
      assert.ok(onlyShard?.shard_id, "Orphan world is missing its shard.");
      shardId = onlyShard.shard_id;
      await query(
        "INSERT INTO game.certification_runs(run_id,world_id,shard_id,expires_at,campaign_mode) VALUES ($1,$2,$3,now()+interval '89 days','persistent')",
        [runId, worldId, shardId],
      );
    }
    cursor = Number(existing.metadata?.persistentCampaign?.nextTurn);
    previousFailures = Number(existing.metadata?.persistentCampaign?.failures || 0);
    assert.ok(
      Number.isInteger(cursor) && cursor >= 0 && cursor <= allBeats.length,
      "Corrupt persistent cursor.",
    );
    const [remaining] = await query(
      "SELECT expires_at > now() + interval '115 minutes' AS active_long_enough FROM game.certification_runs WHERE run_id=$1",
      [runId],
    );
    assert.equal(
      remaining?.active_long_enough,
      true,
      "Persistent campaign certification expires before this batch ends; never extend beyond its 90-day creation cap.",
    );
  } else {
    await query(
      "INSERT INTO game.worlds(world_id,slug,name,metadata) VALUES ($1,$2,'Persistent real-model certification district',$3::jsonb)",
      [
        worldId,
        campaignSlug,
        JSON.stringify({
          isolatedCertification: true,
          persistentCampaign: { version: 1, nextTurn: 0, failures: 0, target: 5000 },
        }),
      ],
    );
    await query(
      "INSERT INTO game.world_shards(shard_id,world_id,slug,name) VALUES ($1,$2,'primary','Primary')",
      [shardId, worldId],
    );
    await query(
      "INSERT INTO game.certification_runs(run_id,world_id,shard_id,expires_at,campaign_mode) VALUES ($1,$2,$3,now()+interval '89 days','persistent')",
      [runId, worldId, shardId],
    );
  }
  beats = allBeats.slice(cursor, cursor + limit);
  assert.ok(
    beats.length,
    "The 5000-turn persistent campaign is already complete. No new work is required.",
  );
  for (const player of players) {
    player.userId = "live-story:" + runId + ":" + player.alias;
    const minted = await agents.createToken({
      userId: player.userId,
      label: "live-story-" + player.alias,
      scopes: ["play", "character:read", "character:write", "action:submit"],
    });
    player.token = minted.token; // NEVER persist or log credentials.
    // Every provisioning step must be retryable. A failed setup can leave the
    // world and certification run committed before all three bindings exist.
    await query(
      "INSERT INTO game.certification_players(run_id,user_id,world_id,shard_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [runId, player.userId, worldId, shardId],
    );
    await query(
      "INSERT INTO game.world_memberships(world_id,user_id,role,status) VALUES ($1,$2,'player','active') ON CONFLICT DO NOTHING",
      [worldId, player.userId],
    );
    const [binding] = await query(
      "SELECT player.run_id,player.world_id,player.shard_id,member.role,member.status FROM game.certification_players player JOIN game.world_memberships member ON member.world_id=player.world_id AND member.user_id=player.user_id WHERE player.user_id=$1",
      [player.userId],
    );
    assert.equal(
      binding?.run_id,
      runId,
      "Existing user is bound to a different certification run.",
    );
    assert.equal(binding?.world_id, worldId);
    assert.equal(binding?.shard_id, shardId);
    assert.equal(binding?.role, "player");
    assert.equal(binding?.status, "active");
  }
  const [districtResult] = await query(
    "SELECT game.provision_certification_district($1) AS district",
    [runId],
  );
  const district = districtResult.district;
  assert.equal(district.worldId, worldId, "District world does not match test run.");
  for (const player of players) {
    const [allocation] = await query(
      "SELECT * FROM game.provision_certification_player($1,$2,$3)",
      [runId, player.userId, player.name],
    );
    assert.ok(allocation?.actor_id && allocation.residence_id);
    player.actorId = allocation.actor_id;
    player.residenceId = allocation.residence_id;
    const dashboard = await send(player, "/v1/persistent-world/dashboard");
    assert.equal(dashboard.status, 200, "Provisioned player cannot access own dashboard.");
    assert.equal(
      (dashboard.data.dashboard || dashboard.data).character.characterId,
      player.actorId,
      "Player dashboard selected the wrong character.",
    );
  }
  assert.equal(new Set(players.map((p) => p.actorId)).size, 3);
  assert.equal(new Set(players.map((p) => p.residenceId)).size, 3);
  let scheduledWorkerReady = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const [heartbeat] = await query(
      "SELECT worker_id FROM system.worker_heartbeats WHERE role='ai_job_worker' AND last_seen_at > now() - interval '30 seconds' LIMIT 1",
    );
    if (heartbeat?.worker_id) {
      scheduledWorkerReady = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.ok(
    scheduledWorkerReady,
    "No live scheduled worker heartbeat; timed actions cannot be certified.",
  );
  completedSetup = true;
  console.log(
    JSON.stringify({
      event: "live_story_provisioned",
      runId,
      worldId,
      shardId,
      players: players.map((p) => ({
        alias: p.alias,
        actorId: p.actorId,
        residenceId: p.residenceId,
      })),
      models: { decision: decisionModel, narrator: narrationModel },
      beatsRequested: beats.length,
      persistentCursor: cursor,
      persistentTarget: allBeats.length,
      accumulatedFailures: previousFailures,
    }),
  );
  const cross = await send(
    players[0],
    "/v1/persistent-world/actions",
    "POST",
    {
      actorId: players[1].actorId,
      command: "Do one push-up.",
    },
    "live-story:" + runId + ":cross-account",
  );
  crossAccountDenied = cross.status === 403;
  assert.ok(crossAccountDenied, "Cross-account action succeeded in isolated world.");

  for (let i = 0; i < beats.length; i += 1) {
    const beat = beats[i];
    try {
      const result = await runBeat(beat, cursor + i);
      turns.push(result);
      // Checkpoint only after obtaining authoritative evidence. The fixed key
      // makes an interrupted turn safe to replay on the next run.
      await query(
        "UPDATE game.worlds SET metadata=jsonb_set(jsonb_set(metadata,'{persistentCampaign,nextTurn}',to_jsonb($2::int),true),'{persistentCampaign,failures}',to_jsonb($3::int),true) WHERE world_id=$1 AND slug=$4",
        [
          worldId,
          cursor + i + 1,
          previousFailures + turns.filter((t) => t.verdict === "observed_failure").length,
          campaignSlug,
        ],
      );
      console.log(
        JSON.stringify({
          beatId: result.beatId,
          actor: result.actor,
          httpStatus: result.httpStatus,
          engineState: result.engineState,
          requestId: result.requestId,
          events: result.events.length,
          verdict: result.verdict,
          defects: result.observedDefects,
          elapsedMs: result.elapsedMs,
        }),
      );
    } catch (err) {
      const failure = {
        beatId: beat.id,
        actor: beat.actor,
        verdict: "harness_failure",
        error: safeError(err),
        storyId: beat.storyId,
      };
      turns.push(failure);
      console.log(JSON.stringify(failure));
      infrastructureError ||=
        "A beat failed before its durable checkpoint; rerun will replay the same idempotency key.";
      break;
    }
  }
} catch (err) {
  infrastructureError = safeError(err);
  console.error(JSON.stringify({ event: "live_story_setup_failed", error: infrastructureError }));
} finally {
  // Do not revoke: the world, membership and prior consequences persist.
  const finishedAt = new Date();
  // The presence of configured model names is NOT proof that either provider
  // was called. Read the compiled API's telemetry instead of trusting the
  // manuscript, response latency, or provider configuration alone.
  const providerEvidence = {
    jevDecisionCalls: 0,
    lagunaNarrationCalls: 0,
    otherProviderCalls: 0,
    failedProviderCalls: 0,
  };
  try {
    const apiLog = await readFile("artifacts/live-story/api-process.log", "utf8");
    for (const line of apiLog.split("\n")) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const event = entry?.telemetry;
      if (!event || typeof event !== "object") continue;
      const model = String(event.model || "").toLowerCase();
      if (event.eventName === "provider_call_failed") {
        providerEvidence.failedProviderCalls += 1;
      }
      if (event.eventName !== "provider_call_completed") continue;
      if (event.details?.inferenceMode === "decision" && model.includes("jev")) {
        providerEvidence.jevDecisionCalls += 1;
      } else if (model.includes("laguna")) {
        providerEvidence.lagunaNarrationCalls += 1;
      } else {
        providerEvidence.otherProviderCalls += 1;
      }
    }
  } catch (err) {
    infrastructureError ||= "Provider telemetry unavailable: " + safeError(err);
  }
  if (completedSetup && providerEvidence.jevDecisionCalls === 0) {
    infrastructureError ||= "No completed Jev provider calls observed in API telemetry.";
  }
  if (completedSetup && providerEvidence.lagunaNarrationCalls === 0) {
    infrastructureError ||= "No completed Laguna provider calls observed in API telemetry.";
  }
  const results = turns.reduce((map, t) => {
    map[t.verdict] = (map[t.verdict] || 0) + 1;
    return map;
  }, {});
  const summary = {
    status: "NOT_CERTIFIED_REQUIRES_DOMAIN_PROBES_AND_NARRATION_REVIEW",
    stage: "real_jev_laguna_persistent_railway_testing_postgres",
    persistent: true,
    previousCursor: cursor,
    nextCursor: cursor + turns.filter((t) => t.verdict !== "harness_failure").length,
    campaignTarget: allBeats.length,
    previousFailures,
    accumulatedFailures:
      previousFailures + turns.filter((t) => t.verdict === "observed_failure").length,
    liveModel: providerEvidence.jevDecisionCalls > 0 && providerEvidence.lagunaNarrationCalls > 0,
    providerEvidence,
    production: false,
    liveOAuthMcp: false,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    runId,
    worldId,
    shardId,
    requestedBeats: beats.length,
    attemptedBeats: turns.length,
    results,
    crossAccountDenied,
    revokedDenied,
    decisionModel,
    narrationModel,
    infrastructureError,
    firstFailure:
      turns.find((t) => t.verdict === "observed_failure" || t.verdict === "harness_failure")
        ?.beatId || null,
    note: "Every beat attempted; a 2xx response does not prove story/semantic/narration correctness.",
  };
  await mkdir("artifacts/live-story", { recursive: true });
  await writeFile(
    "artifacts/live-story/results.json",
    JSON.stringify(
      {
        summary,
        players: players.map((p) => ({
          alias: p.alias,
          userId: p.userId,
          actorId: p.actorId,
          residenceId: p.residenceId,
        })),
        turns,
      },
      null,
      2,
    ),
  );
  const markdown = [
    "# Nocturne: live three-player story — observed responses, not certified fiction",
    "",
    "Live Jev: " + decisionModel + "; Laguna: " + narrationModel,
    "Run: " + runId + "; persistent isolated world: " + worldId,
    "Campaign cursor: " + cursor + " to " + (cursor + turns.length) + " / " + allBeats.length,
    "Result: " + JSON.stringify(summary.results),
    "",
  ];
  for (const t of turns) {
    markdown.push(
      "## " + t.beatId + " — " + t.actor,
      "",
      "Input: " + (t.originalStoryCommand || ""),
      "",
      "Game reply: " + (t.narration || "(none)"),
      "",
      "Authoritative result: " + (t.durableRequestStatus || t.engineState || t.error || "(none)"),
      "Event IDs: " + (t.events || []).map((e) => e.eventId).join(", "),
      "Observed defects: " + (t.observedDefects || []).join(", "),
      "",
    );
  }
  await writeFile("artifacts/live-story/transcript.md", markdown.join("\n"));
  console.log(JSON.stringify({ event: "live_story_summary", ...summary }));
  await db.close();
  // This is an evidence-generating diagnostic, not a release gate yet. Missing
  // domain probes mean it cannot mark the 72-beat game as passed. Fail on
  // infrastructure/scope violations, even if an ordinary action was rejected.
  if (
    infrastructureError ||
    !completedSetup ||
    !crossAccountDenied ||
    turns.length !== beats.length ||
    previousFailures > 0 ||
    // A diagnostic with observed failures is RED, never a passing story run.
    turns.some((t) => t.verdict === "observed_failure") ||
    turns.some(
      (t) =>
        t.verdict === "harness_failure" ||
        t.observedDefects?.some((d) =>
          [
            "request_scope_mismatch",
            "event_scope_or_link_mismatch",
            "player_dashboard_missing_or_wrong",
          ].includes(d),
        ),
    )
  ) {
    process.exitCode = 1;
  }
}
