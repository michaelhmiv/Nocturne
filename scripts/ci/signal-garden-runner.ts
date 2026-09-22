import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createAgentStore,
  createDatabase,
  DEFAULT_SHARD_ID,
  DEFAULT_WORLD_ID,
} from "../../packages/database/src/index.js";
import {
  applySignalGardenTurn,
  auditSignalGardenCampaign,
  createInitialSignalGardenState,
  generateSignalGardenCampaign,
  SIGNAL_GARDEN_DEFAULT_SEED,
  SIGNAL_GARDEN_SIGNATURE_ACTION,
  SIGNAL_GARDEN_TITLE,
  type SignalGardenState,
  type SignalGardenTurn,
} from "./signal-garden-campaign.js";

type Player = {
  alias: string;
  name: string;
  userId: string;
  token: string;
  actorId: string;
  residenceId: string;
};

type ApiReply = {
  status: number;
  payload: Record<string, any>;
  text: string;
};

type TurnEvidence = {
  sequence: number;
  chapter: number;
  beat: number;
  phase: string;
  player: string;
  actionType: string;
  expectedWorldKind: string;
  actualState: string;
  requestId: string;
  planId: string | null;
  stepId: string | null;
  eventIds: string[];
  scheduleIds: string[];
  signatureAction: boolean;
  packetId: string;
  replayed: boolean;
};

const databaseUrl = process.env.DATABASE_URL || "postgres://invalid:invalid@invalid/invalid";
const apiUrl = (process.env.NOCTURNE_API_URL || "http://127.0.0.1:3101").replace(/\/$/, "");
const turnsRequested = Number(process.env.SIGNAL_GARDEN_TURNS || "5000");
const seed = process.env.SIGNAL_GARDEN_SEED || SIGNAL_GARDEN_DEFAULT_SEED;
const resultPath = process.env.SIGNAL_GARDEN_RESULTS || "artifacts/signal-garden-5000.json";

function requireSandbox() {
  assert.equal(
    process.env.NOCTURNE_STORY_SANDBOX,
    "1",
    "Signal Garden requires the explicit disposable-story sandbox flag.",
  );
  const databaseAddress = new URL(databaseUrl);
  const apiAddress = new URL(apiUrl);
  assert.ok(
    ["localhost", "127.0.0.1"].includes(databaseAddress.hostname),
    "Refusing to run the campaign against a remote database.",
  );
  assert.equal(
    databaseAddress.pathname,
    "/nocturne_integration",
    "Refusing to run the campaign outside the disposable integration database.",
  );
  assert.ok(
    ["localhost", "127.0.0.1"].includes(apiAddress.hostname),
    "Refusing to run the campaign against a remote API.",
  );
  assert.ok(turnsRequested > 0 && turnsRequested <= 100_000);
}

function jsonRecord(text: string): Record<string, any> {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : { value };
  } catch {
    return { raw: text };
  }
}

async function api(
  player: Pick<Player, "token">,
  path: string,
  method = "GET",
  body?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<ApiReply> {
  const headers: Record<string, string> = {
    authorization: "Bearer " + player.token,
  };
  if (body) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const response = await fetch(apiUrl + path, {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, payload: jsonRecord(text), text };
}

async function ok(
  player: Pick<Player, "token">,
  path: string,
  method = "GET",
  body?: Record<string, unknown>,
  idempotencyKey?: string,
) {
  const reply = await api(player, path, method, body, idempotencyKey);
  assert.ok(
    reply.status >= 200 && reply.status < 300,
    method + " " + path + " returned " + reply.status + ": " + reply.text.slice(0, 1_000),
  );
  return reply.payload;
}

function pad(value: number, width: number) {
  return String(value).padStart(width, "0");
}

async function setupPlayer(
  database: ReturnType<typeof createDatabase>,
  agents: ReturnType<typeof createAgentStore>,
  runId: string,
  alias: string,
  name: string,
): Promise<Player> {
  const userId = "signal-garden:" + runId + ":" + alias;
  const tokenRecord = await agents.createToken({
    userId,
    label: "signal-garden-" + alias,
    scopes: ["play", "character:read", "character:write", "action:submit"],
  });
  const player = { alias, name, userId, token: tokenRecord.token } as Player;
  const created = await ok(
    player,
    "/v1/characters",
    "POST",
    {
      name,
      conceptSummary:
        "An original Signal Garden investigator whose actions are isolated to this disposable story run.",
      originSource: "ci",
      qualities: {
        investigation: 8,
        combat: 8,
        stealth: 8,
        persuasion: 8,
        mechanics: 8,
        hacking: 8,
        medicine: 8,
        engineering: 8,
        electronics: 8,
        driving: 8,
        athletics: 8,
      },
    },
    "signal-garden-character:" + runId + ":" + alias,
  );
  player.actorId = String(created.characterId);
  assert.ok(player.actorId);
  await ok(player, "/v1/characters/" + player.actorId + "/select", "POST", {});
  const residence = await ok(
    player,
    "/v1/residences/starter/rent",
    "POST",
    { characterId: player.actorId },
    "signal-garden-residence:" + runId + ":" + alias,
  );
  player.residenceId = String(residence.residenceId);
  assert.ok(player.residenceId);

  const actorRows = await database.client.unsafe<
    { world_id: string; shard_id: string; location_id: string | null }[]
  >("SELECT world_id, shard_id, location_id FROM game.entity_instances WHERE instance_id = $1", [
    player.actorId,
  ]);
  assert.equal(actorRows.length, 1);
  assert.equal(actorRows[0]?.world_id, DEFAULT_WORLD_ID);
  assert.equal(actorRows[0]?.shard_id, DEFAULT_SHARD_ID);
  assert.ok(actorRows[0]?.location_id);
  return player;
}

async function verifyDurability(
  database: ReturnType<typeof createDatabase>,
  player: Player,
  turn: SignalGardenTurn,
  reply: ApiReply,
) {
  const requestId = String(reply.payload.requestId || "");
  assert.match(requestId, /^[0-9a-f-]{36}$/i);
  const requestRows = await database.client.unsafe<
    {
      request_id: string;
      user_id: string;
      actor_id: string;
      world_id: string;
      shard_id: string;
      status: string;
      plan_id: string | null;
    }[]
  >(
    "SELECT request_id,user_id,actor_id,world_id,shard_id,status,plan_id " +
      "FROM game.world_action_requests WHERE request_id = $1",
    [requestId],
  );
  const request = requestRows[0];
  assert.ok(request, "Turn request was not durable.");
  assert.equal(request.user_id, player.userId);
  assert.equal(request.actor_id, player.actorId);
  assert.equal(request.world_id, DEFAULT_WORLD_ID);
  assert.equal(request.shard_id, DEFAULT_SHARD_ID);
  assert.equal(request.status, reply.payload.state);

  if (reply.payload.state === "waiting_for_clarification") {
    assert.equal(request.plan_id, null);
    return { requestId, planId: null, stepId: null, eventIds: [], scheduleIds: [] };
  }

  assert.ok(request.plan_id, "Executable turn has no persistent plan.");
  const stepRows = await database.client.unsafe<
    {
      step_id: string;
      step_kind: string;
      status: string;
      intent_payload: Record<string, unknown>;
      result_event_id: string | null;
    }[]
  >(
    "SELECT step_id,step_kind,status,intent_payload,result_event_id " +
      "FROM game.action_plan_steps WHERE plan_id = $1 ORDER BY step_order",
    [request.plan_id],
  );
  const step = stepRows[0];
  assert.ok(step, "Executable turn has no plan step.");
  assert.equal(step.step_kind, turn.expectedWorldKind);
  assert.equal(step.intent_payload.actionType, turn.actionType);
  if (reply.payload.state === "completed") {
    assert.equal(step.status, "completed");
    assert.ok(step.result_event_id, "Completed turn has no event.");
  }

  const scheduleRows = await database.client.unsafe<{ schedule_id: string }[]>(
    "SELECT schedule_id FROM game.scheduled_actions WHERE plan_id = $1 ORDER BY created_at",
    [request.plan_id],
  );
  return {
    requestId,
    planId: request.plan_id,
    stepId: step.step_id,
    eventIds: step.result_event_id ? [step.result_event_id] : [],
    scheduleIds: scheduleRows.map((row) => row.schedule_id),
  };
}

function extractPlanEvidence(turn: SignalGardenTurn, reply: ApiReply) {
  const plan = reply.payload.plan;
  if (reply.payload.state === "waiting_for_clarification") {
    assert.equal(plan, undefined);
    assert.equal(typeof reply.payload.prompt, "string");
    return { planId: null, stepId: null, eventIds: [], scheduleIds: [] };
  }

  assert.ok(plan && typeof plan === "object");
  assert.ok(Array.isArray(plan.steps) && plan.steps.length > 0);
  const step = plan.steps[0];
  assert.equal(step.kind, turn.expectedWorldKind);
  assert.equal(step.intentPayload?.actionType, turn.actionType);
  assert.equal(typeof reply.payload.narration, "string");
  assert.ok(reply.payload.narration.length > 0);
  const eventIds = Array.isArray(reply.payload.eventIds) ? reply.payload.eventIds : [];
  if (reply.payload.state === "completed") assert.ok(eventIds.length > 0);
  const scheduleIds = Array.isArray(plan.schedules)
    ? plan.schedules.map((schedule: { scheduleId?: string }) => String(schedule.scheduleId))
    : [];
  return {
    planId: typeof plan.planId === "string" ? plan.planId : null,
    stepId: typeof step.stepId === "string" ? step.stepId : null,
    eventIds,
    scheduleIds,
  };
}

async function replayAndAssert(
  player: Player,
  turn: SignalGardenTurn,
  key: string,
  first: ApiReply,
) {
  const replay = await api(
    player,
    "/v1/persistent-world/actions",
    "POST",
    { actorId: player.actorId, command: turn.command },
    key,
  );
  assert.ok(
    replay.status >= 200 && replay.status < 300,
    "Idempotent replay failed for turn " + turn.sequence + ": " + replay.text.slice(0, 1_000),
  );
  assert.equal(replay.payload.requestId, first.payload.requestId);
  assert.equal(replay.payload.state, first.payload.state);
  if (first.payload.state === "completed") {
    assert.deepEqual(replay.payload.eventIds, first.payload.eventIds);
  }
}

async function sampleViewChecks(player: Player, sequence: number) {
  const dashboard = await ok(player, "/v1/persistent-world/dashboard");
  const dashboardPayload = dashboard.dashboard || dashboard;
  assert.equal(dashboardPayload.character?.characterId, player.actorId);
  if (sequence % 125 === 0) {
    const scene = await ok(player, "/v1/persistent-world/scene");
    assert.ok(scene.location, "Scene response omitted the authoritative location.");
  }
}

async function assertAggregateDurability(
  database: ReturnType<typeof createDatabase>,
  requestIds: string[],
  eventIds: string[],
) {
  const requestCounts = await database.client.unsafe<{ requests: number; non_failed: number }[]>(
    "SELECT count(*)::int AS requests, " +
      "count(*) FILTER (WHERE status <> 'failed')::int AS non_failed " +
      "FROM game.world_action_requests WHERE request_id = ANY($1::uuid[])",
    [requestIds],
  );
  assert.equal(requestCounts[0]?.requests, requestIds.length);
  assert.equal(requestCounts[0]?.non_failed, requestIds.length);

  if (eventIds.length) {
    const eventCounts = await database.client.unsafe<{ events: number }[]>(
      "SELECT count(*)::int AS events FROM game.event_ledger WHERE event_id = ANY($1::uuid[])",
      [eventIds],
    );
    assert.equal(eventCounts[0]?.events, eventIds.length);
  }
}

async function main() {
  requireSandbox();
  const campaign = generateSignalGardenCampaign({ turns: turnsRequested, seed });
  const audit = auditSignalGardenCampaign(campaign);
  assert.deepEqual(audit.errors, []);
  assert.equal(audit.commandCount, campaign.length);
  assert.equal(audit.packetCount, campaign.length);
  assert.equal(audit.playerCount, 3);
  assert.equal(audit.signatureTurns.length, campaign.filter((turn) => turn.signatureAction).length);

  const database = createDatabase(databaseUrl);
  const agents = createAgentStore(database);
  const runId = randomUUID();
  const evidence: TurnEvidence[] = [];
  const requestIds: string[] = [];
  const eventIds: string[] = [];
  const requestSet = new Set<string>();
  const eventSet = new Set<string>();
  let state: SignalGardenState = createInitialSignalGardenState();
  let completed = 0;
  let waiting = 0;
  let clarification = 0;

  try {
    const players = [
      await setupPlayer(database, agents, runId, "mara", "Mara Velez"),
      await setupPlayer(database, agents, runId, "dax", "Dax Mercer"),
      await setupPlayer(database, agents, runId, "imani", "Imani Brooks"),
    ];
    const playerByAlias = new Map(players.map((player) => [player.alias, player]));

    for (const turn of campaign) {
      const player = playerByAlias.get(turn.playerAlias);
      assert.ok(player);
      const key = "signal-garden-turn:" + runId + ":" + pad(turn.sequence, 5);
      const first = await api(
        player,
        "/v1/persistent-world/actions",
        "POST",
        { actorId: player.actorId, command: turn.command },
        key,
      );
      assert.ok(
        first.status >= 200 && first.status < 300,
        "Turn " +
          turn.sequence +
          " (" +
          turn.actionType +
          ") returned " +
          first.status +
          ": " +
          first.text.slice(0, 1_500),
      );
      assert.ok(
        ["completed", "waiting", "waiting_for_clarification"].includes(String(first.payload.state)),
        "Turn returned an unexpected state: " + first.text.slice(0, 1_500),
      );

      const planEvidence = extractPlanEvidence(turn, first);
      let durableEvidence = {
        requestId: String(first.payload.requestId),
        planId: planEvidence.planId,
        stepId: planEvidence.stepId,
        eventIds: planEvidence.eventIds,
        scheduleIds: planEvidence.scheduleIds,
      };
      if (turn.signatureAction || turn.sequence % 50 === 0) {
        durableEvidence = await verifyDurability(database, player, turn, first);
      }
      assert.ok(durableEvidence.requestId);
      assert.equal(requestSet.has(durableEvidence.requestId), false);
      requestSet.add(durableEvidence.requestId);
      requestIds.push(durableEvidence.requestId);

      for (const eventId of planEvidence.eventIds) {
        assert.equal(eventSet.has(eventId), false, "Duplicate committed event " + eventId);
        eventSet.add(eventId);
        eventIds.push(eventId);
      }

      const actualState = String(first.payload.state) as
        "completed" | "waiting" | "waiting_for_clarification";
      if (actualState === "completed") completed += 1;
      else if (actualState === "waiting") waiting += 1;
      else clarification += 1;
      state = applySignalGardenTurn(state, turn, {
        state: actualState,
        eventIds: planEvidence.eventIds,
      });

      const shouldReplay = turn.signatureAction || turn.sequence % 97 === 0;
      if (shouldReplay) await replayAndAssert(player, turn, key, first);
      if (turn.sequence % 25 === 0) await sampleViewChecks(player, turn.sequence);

      evidence.push({
        sequence: turn.sequence,
        chapter: turn.chapter,
        beat: turn.beat,
        phase: turn.phase,
        player: turn.playerAlias,
        actionType: turn.actionType,
        expectedWorldKind: turn.expectedWorldKind,
        actualState,
        requestId: durableEvidence.requestId,
        planId: durableEvidence.planId,
        stepId: durableEvidence.stepId,
        eventIds: planEvidence.eventIds,
        scheduleIds: durableEvidence.scheduleIds,
        signatureAction: turn.signatureAction,
        packetId: turn.packetId,
        replayed: shouldReplay,
      });

      if ((turn.sequence + 1) % 250 === 0) {
        console.log(
          JSON.stringify({
            campaign: SIGNAL_GARDEN_TITLE,
            progress: turn.sequence + 1,
            total: campaign.length,
            completed,
            waiting,
            clarification,
            relays: state.relayCount,
          }),
        );
      }
    }

    await assertAggregateDurability(database, requestIds, eventIds);

    const forbidden = await api(
      players[1],
      "/v1/persistent-world/actions",
      "POST",
      { actorId: players[0].actorId, command: "Do one push-up." },
      "signal-garden-cross-account:" + runId,
    );
    assert.equal(forbidden.status, 403);
    const forbiddenDashboard = await api(
      players[1],
      "/v1/persistent-world/dashboard?actorId=" + players[0].actorId,
    );
    assert.equal(forbiddenDashboard.status, 403);

    const report = {
      status: "passed",
      campaign: SIGNAL_GARDEN_TITLE,
      signatureAction: SIGNAL_GARDEN_SIGNATURE_ACTION,
      seed,
      runId,
      turnsRequested: campaign.length,
      turnsExecuted: requestIds.length,
      players: players.map(({ alias, name, userId, actorId, residenceId }) => ({
        alias,
        name,
        userId,
        actorId,
        residenceId,
      })),
      actionCoverage: audit.actionCounts,
      signatureTurns: audit.signatureTurns.length,
      resultStates: { completed, waiting, waitingForClarification: clarification },
      stateMachine: state,
      checks: {
        uniqueCommands: audit.commandCount === campaign.length,
        uniquePackets: audit.packetCount === campaign.length,
        uniqueRequests: requestSet.size === requestIds.length,
        uniqueEvents: eventSet.size === eventIds.length,
        allActionTypesCovered: Object.keys(audit.actionCounts).length === 25,
        allThreePlayersUsed: audit.playerCount === 3,
        idempotentReplaySamples: evidence.filter((turn) => turn.replayed).length,
        crossAccountActionDenied: true,
        crossAccountDashboardDenied: true,
        databaseDurability: true,
        noFailedTurns: completed + waiting + clarification === campaign.length,
      },
      evidence: evidence.filter(
        (turn) => turn.signatureAction || turn.sequence % 50 === 0 || turn.sequence < 25,
      ),
    };
    await mkdir(dirname(resultPath), { recursive: true });
    await writeFile(resultPath, JSON.stringify(report, null, 2));
    console.log(
      JSON.stringify({
        status: report.status,
        campaign: report.campaign,
        signatureAction: report.signatureAction,
        seed: report.seed,
        turns: report.turnsExecuted,
        players: report.players.length,
        actionTypes: Object.keys(report.actionCoverage).length,
        signatureTurns: report.signatureTurns,
        completed: report.resultStates.completed,
        waiting: report.resultStates.waiting,
        waitingForClarification: report.resultStates.waitingForClarification,
        relays: report.stateMachine.relayCount,
        replaySamples: report.checks.idempotentReplaySamples,
        artifact: resultPath,
      }),
    );
  } catch (error) {
    await mkdir(dirname(resultPath), { recursive: true });
    await writeFile(
      resultPath,
      JSON.stringify(
        {
          status: "failed",
          campaign: SIGNAL_GARDEN_TITLE,
          seed,
          turnsRequested: campaign.length,
          turnsObserved: requestIds.length,
          error: error instanceof Error ? error.message : String(error),
          evidence: evidence.slice(-100),
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    await database.close();
  }
}

const directScript = process.argv[1]?.endsWith("signal-garden-runner.ts");
if (directScript) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { main as runSignalGardenCampaign };
