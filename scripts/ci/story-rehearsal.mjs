/**
 * Real-gameplay STORY REHEARSAL (not release certification). Uses callbacks
 * supplied by a real isolated-world API/PostgreSQL integration runner.
 *
 * The transcript never invents a success or marks a domain probe as passed.
 * Unsupported beats, waiting real-time work and model/story failures remain
 * explicit issues; the strict 72-beat claim auditor is deliberately NOT called.
 */
const VALID_STATES = new Set([
  "completed",
  "failed",
  "waiting",
  "waiting_for_clarification",
  "rejected",
]);

const textForPlayer = (outcome) => {
  if (!outcome || typeof outcome !== "object") return null;
  for (const candidate of [
    outcome.narration,
    outcome.plan?.narration,
    outcome.prompt,
    outcome.playerSafeResult?.narration,
  ]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return null;
};

export async function rehearseStory({ story, players, runId, worldId, shardId, submit, snapshot, readEvidence }) {
  if (!story || !Array.isArray(story.acts) || story.acts.length === 0) {
    throw new Error("Story manifest with acts is required.");
  }
  const actors = new Map(players.map((player) => [player.alias, player]));
  if (actors.size !== story.players.length) {
    throw new Error("One distinct player per story identity is required.");
  }
  for (const spec of story.players) {
    const p = actors.get(spec.id);
    if (!p?.userId || !p.actorId) {
      throw new Error("Missing independently identified story actor " + spec.id);
    }
  }
  const turns = [];
  const keys = new Map();
  const observed = new Map();
  for (const act of story.acts) {
    for (const beat of act.beats) {
      const player = actors.get(beat.actor);
      const key = beat.sameKeyAs
        ? keys.get(beat.sameKeyAs)
        : "story-rehearsal:" + runId + ":" + beat.id;
      if (!key) throw new Error("Missing replay key for " + beat.id);
      if (!beat.sameKeyAs) keys.set(beat.id, key);
      const record = {
        beatId: beat.id,
        actId: act.id,
        actor: beat.actor,
        userId: player.userId,
        actorId: player.actorId,
        worldId,
        shardId,
        command: beat.text,
        idempotencyKey: key,
        clock: beat.clock || null,
        expectedChecks: beat.checks,
        attempted: false,
        httpStatus: null,
        state: null,
        requestId: null,
        narration: null,
        eventIds: [],
        durableEvidence: null,
        before: null,
        after: null,
        issues: [],
        acceptance: "unverified",
      };
      turns.push(record);
      try {
        record.before = await snapshot(player);
      } catch (error) {
        record.issues.push("before_snapshot_failed:" + String(error.message || error));
      }
      try {
        // Exactly one real HTTP request per beat, rotating true credentials.
        record.attempted = true;
        const result = await submit({ player, beat, key });
        record.httpStatus = result.status;
        const outcome = result.result;
        record.state = outcome?.state || null;
        record.requestId = outcome?.requestId || null;
        record.narration = textForPlayer(outcome);
        if (result.status >= 500 || result.status < 200) {
          record.issues.push("server_http_" + result.status);
        } else if (result.status >= 400) {
          record.issues.push("player_http_" + result.status + ":" + (outcome?.error || "unknown"));
        }
        if (result.status >= 200 && result.status < 300) {
          if (!record.requestId) record.issues.push("successful_response_without_request_id");
          if (!VALID_STATES.has(record.state)) record.issues.push("unknown_action_state");
          if (!record.narration) record.issues.push("missing_player_facing_narration");
        }
        if (record.requestId) {
          try {
            record.durableEvidence = await readEvidence(record.requestId);
            const db = record.durableEvidence;
            if (!db?.request) {
              record.issues.push("request_not_found_in_postgres");
            } else {
              if (
                db.request.userId !== record.userId ||
                db.request.actorId !== record.actorId ||
                db.request.worldId !== worldId ||
                db.request.shardId !== shardId
              ) record.issues.push("request_scope_or_actor_mismatch");
              record.eventIds = (db.events || []).map((event) => event.eventId);
              if ((db.events || []).some(
                (event) => event.worldId !== worldId || event.shardId !== shardId,
              )) record.issues.push("event_scope_mismatch");
              if (record.state === "completed" && record.eventIds.length === 0) {
                record.issues.push("completed_without_durable_event");
              }
              if (record.state === "waiting" && !(db.schedules || []).length) {
                record.issues.push("waiting_without_durable_schedule");
              }
            }
          } catch (error) {
            record.issues.push("evidence_read_failed:" + String(error.message || error));
          }
        }
      } catch (error) {
        record.issues.push("submit_failed:" + String(error.message || error));
      }
      try {
        record.after = await snapshot(player);
      } catch (error) {
        record.issues.push("after_snapshot_failed:" + String(error.message || error));
      }
      // These two claims are independent of a game's attempt/success
      // language. The committed state, not the narration, is the oracle.
      if (beat.checks.includes("no_claim_mutation") &&
          record.before?.propertyFingerprint !== record.after?.propertyFingerprint) {
        record.issues.push("spoken_claim_changed_authoritative_property");
      }
      if (beat.checks.includes("no_missing_consumption") &&
          record.before?.resourceFingerprint !== record.after?.resourceFingerprint) {
        record.issues.push("missing_consumable_changed_authoritative_resources");
      }
      if (beat.clock === "real") {
        // Merely scheduling work NEVER proves the declared elapsed time.
        record.issues.push("real_time_completion_not_certified");
      }
      if (beat.sameKeyAs) {
        const original = observed.get(beat.sameKeyAs);
        if (original &&
            (original.requestId !== record.requestId ||
             original.idempotencyKey !== record.idempotencyKey)) {
          record.issues.push("idempotent_replay_changed_request");
        }
      }
      observed.set(beat.id, record);
    }
  }
  const expected = story.acts.reduce((total, act) => total + act.beats.length, 0);
  const counts = {
    expected,
    attempted: turns.filter((turn) => turn.attempted).length,
    evidenceLinked: turns.filter((turn) => turn.durableEvidence?.request).length,
    serverErrors: turns.filter((turn) => turn.issues.some((issue) =>
      issue.startsWith("server_http_") || issue.startsWith("submit_failed:"),
    )).length,
    scopedViolations: turns.filter((turn) => turn.issues.some((issue) =>
      issue.includes("scope_or_actor_mismatch") || issue.includes("event_scope_mismatch"),
    )).length,
    beatsWithOpenIssues: turns.filter((turn) => turn.issues.length).length,
  };
  return {
    kind: "real-http-postgres-three-player-story-diagnostic",
    certified: false,
    liveModel: false,
    runId,
    storyId: story.id,
    storyTitle: story.title,
    setting: story.setting,
    worldId,
    shardId,
    counts,
    players: players.map(({ alias, userId, actorId, residenceId }) => ({
      alias, userId, actorId, residenceId,
    })),
    turns,
  };
}

export function renderRehearsalNovella(story, report) {
  const lines = [
    "# " + story.title,
    "",
    "> Diagnostic transcript of actual engine responses, NOT a verified novel or release certification.",
    "",
    story.setting,
    "",
    "**Run:** " + report.runId + " · **world:** " + report.worldId,
    "**Beats attempted:** " + report.counts.attempted + "/" + report.counts.expected +
      " · **release certified:** NO",
    "",
  ];
  for (const act of story.acts) {
    lines.push("## " + act.id.replaceAll("-", " "), "", act.setup, "");
    for (const beat of act.beats) {
      const record = report.turns.find((turn) => turn.beatId === beat.id);
      lines.push("### " + beat.id + " · " + beat.actor, "",
        "**Command:** " + beat.text, "",
        "**Actual response:** " + (record?.narration || "(No player-facing narration.)"), "",
        "**HTTP/state:** " + (record?.httpStatus ?? "no response") + "/" +
          (record?.state || "unknown") + " · **request:** " +
          (record?.requestId || "none") + " · **events:** " +
          (record?.eventIds.join(", ") || "none"),
        "**Open checks:** " + (record?.issues.join("; ") || "Not independently certified."), "");
    }
  }
  return lines.join("\n") + "\n";
}
