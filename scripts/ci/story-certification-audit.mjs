import {
  STORY_CERTIFICATION_CASES,
  STORY_CERTIFICATION_BEATS,
} from "./story-certification-corpus.mjs";

const CHECKS = new Set([
  "request",
  "log",
  "narration",
  "location",
  "knowledge",
  "no_invention",
  "resources",
  "ownership",
  "schedule",
  "time",
  "no_claim_mutation",
  "no_missing_consumption",
  "search",
  "continuity",
  "preference",
  "access",
  "presence",
  "dialogue",
  "visibility",
  "privacy",
  "no_overdraft",
  "physical",
  "terminal_failure",
  "compound",
  "evidence",
  "damage",
  "inventory",
  "employment",
  "concurrency",
  "replay",
  "no_duplicate_payment",
  "offline",
  "identity",
  "news",
  "recovery",
  "provenance",
  "repair",
  "event",
]);

function error(errors, position, message) {
  errors.push(position + ": " + message);
}

export function validateStoryCorpus(stories = STORY_CERTIFICATION_CASES) {
  const errors = [];
  const storyIds = new Set();
  const beatIds = new Set();
  if (!Array.isArray(stories) || stories.length === 0) {
    return ["story corpus must contain at least one story"];
  }
  for (const story of stories) {
    if (!story || typeof story.id !== "string" || !story.id) {
      error(errors, "story", "missing stable story id");
      continue;
    }
    if (storyIds.has(story.id)) error(errors, story.id, "duplicate story id");
    storyIds.add(story.id);
    if (story.stage !== "specification") {
      error(errors, story.id, "unexecuted stories must remain labelled specification");
    }
    if (typeof story.title !== "string" || !story.title.trim()) {
      error(errors, story.id, "story needs a title");
    }
    if (typeof story.setting !== "string" || story.setting.trim().length < 80) {
      error(errors, story.id, "story needs a substantive narrative setting");
    }
    const actors = new Set();
    const names = new Set();
    for (const player of story.players || []) {
      if (!player?.id || !player?.name || !player?.disposition) {
        error(errors, story.id, "player must have id, name and disposition");
        continue;
      }
      if (actors.has(player.id) || names.has(player.name)) {
        error(errors, story.id, "duplicate player identity");
      }
      actors.add(player.id);
      names.add(player.name);
    }
    if (actors.size < 3)
      error(errors, story.id, "story requires at least three independent players");
    const priorBeats = new Map();
    const actIds = new Set();
    for (const act of story.acts || []) {
      if (!act?.id || actIds.has(act.id)) error(errors, story.id, "missing/duplicate act");
      actIds.add(act?.id);
      if (typeof act?.setup !== "string" || act.setup.trim().length < 40) {
        error(errors, story.id + "/" + act?.id, "act requires narrative setup");
      }
      if (!Array.isArray(act?.beats) || act.beats.length < 4) {
        error(errors, story.id + "/" + act?.id, "act needs four or more beats");
      }
      for (const beat of act?.beats || []) {
        const at = story.id + "/" + act.id + "/" + beat?.id;
        if (!beat?.id || beatIds.has(beat.id)) error(errors, at, "missing/duplicate beat id");
        beatIds.add(beat?.id);
        if (!actors.has(beat?.actor)) error(errors, at, "actor is not a story player");
        if (typeof beat?.text !== "string" || beat.text.trim().length < 12) {
          error(errors, at, "beat needs meaningful natural-language player text");
        }
        if (!Array.isArray(beat?.checks) || new Set(beat.checks).size !== beat.checks.length) {
          error(errors, at, "checks must be an array without duplicates");
        } else {
          for (const basic of ["request", "log", "narration"]) {
            if (!beat.checks.includes(basic)) error(errors, at, "missing mandatory " + basic);
          }
          if (beat.checks.length < 5) error(errors, at, "need at least two domain-specific checks");
          for (const check of beat.checks) {
            if (!CHECKS.has(check)) error(errors, at, "unknown check " + check);
          }
        }
        if (beat.clock !== undefined && beat.clock !== "real") {
          error(errors, at, "timed story beats must use real elapsed time");
        }
        if (beat.clock === "real" && !beat.checks?.includes("time")) {
          error(errors, at, "real-time beat missing time check");
        }
        if (beat.sameKeyAs) {
          const prior = priorBeats.get(beat.sameKeyAs);
          if (!prior || prior.actor !== beat.actor || !beat.checks?.includes("replay")) {
            error(errors, at, "replay must reference earlier same-actor beat with replay check");
          }
        }
        priorBeats.set(beat.id, beat);
      }
    }
    if (actIds.size < 3) error(errors, story.id, "story must cover at least three acts");
    if (priorBeats.size < 18) error(errors, story.id, "story must cover at least 18 beats");
  }
  if (stories.length >= 4 && beatIds.size < 72) {
    error(errors, "corpus", "full campaign must contain at least 72 distinct beats");
  }
  return errors;
}

/**
 * Post-execution evidence audit. The recording adapter must obtain its
 * request/trace/event/probe evidence from the real engine/API/database, not
 * from Laguna narration or a model-generated account of what happened.
 *
 * A passed probe is NOT proof without source and evidenceId. The runner must
 * write separate raw/sanitized artifacts for all evidence IDs.
 * Live runner and scoped inspector: issue #138.
 */
export function auditStoryTranscript(story, transcript) {
  const errors = [];
  const prefix = story?.id || "story";
  const manifestErrors = validateStoryCorpus([story]);
  if (manifestErrors.length) return manifestErrors;
  if (!transcript || !Array.isArray(transcript.players) || !Array.isArray(transcript.turns)) {
    return [prefix + ": missing recorded players or turns"];
  }
  const playerIds = new Map();
  const accountIds = new Set();
  const actorIds = new Set();
  for (const player of transcript.players) {
    if (!player?.alias || !player?.userId || !player?.actorId) {
      error(errors, prefix, "every player needs alias, account ID and real actor ID");
      continue;
    }
    if (
      playerIds.has(player.alias) ||
      accountIds.has(player.userId) ||
      actorIds.has(player.actorId)
    ) {
      error(errors, prefix, "player accounts and characters must be distinct");
    }
    playerIds.set(player.alias, player);
    accountIds.add(player.userId);
    actorIds.add(player.actorId);
  }
  for (const actor of story.players) {
    if (!playerIds.has(actor.id)) error(errors, prefix, "missing player " + actor.id);
  }
  if (!transcript.worldId || !transcript.shardId || !transcript.runId) {
    error(errors, prefix, "missing world/shard/run scope");
  }
  const scripted = story.acts.flatMap((act) => act.beats);
  const keys = new Map();
  const requests = new Set();
  if (transcript.turns.length !== scripted.length) {
    error(errors, prefix, "recorded turn count must match full script without skips");
  }
  for (let index = 0; index < scripted.length; index++) {
    const beat = scripted[index];
    const record = transcript.turns[index];
    const at = prefix + "/" + beat.id;
    if (!record || record.beatId !== beat.id || record.actor !== beat.actor) {
      error(errors, at, "missing/out-of-order beat or wrong actor");
      continue;
    }
    const player = playerIds.get(beat.actor);
    if (
      record.userId !== player?.userId ||
      record.actorId !== player?.actorId ||
      record.worldId !== transcript.worldId ||
      record.shardId !== transcript.shardId
    ) {
      error(errors, at, "mismatched authenticated actor or world scope");
    }
    if (!record.requestId || !record.idempotencyKey || !record.trace?.requestId) {
      error(errors, at, "missing real request, idempotency key or trace");
    } else {
      if (record.trace.requestId !== record.requestId) {
        error(errors, at, "request and trace IDs disagree");
      }
      if (record.trace.actorId !== record.actorId || record.trace.worldId !== transcript.worldId) {
        error(errors, at, "trace actor/world scope mismatch");
      }
      if (requests.has(record.requestId) && !beat.sameKeyAs) {
        error(errors, at, "new beat reused a request ID");
      }
      requests.add(record.requestId);
    }
    if (beat.sameKeyAs) {
      const first = keys.get(beat.sameKeyAs);
      if (!first || first.key !== record.idempotencyKey || first.requestId !== record.requestId) {
        error(errors, at, "idempotent replay must return the original request and key");
      }
    } else {
      keys.set(beat.id, { key: record.idempotencyKey, requestId: record.requestId });
    }
    if (
      !["completed", "failed", "waiting", "waiting_for_clarification", "rejected"].includes(
        record.state,
      )
    ) {
      error(errors, at, "unknown request state");
    }
    if (record.state === "waiting" && !record.scheduleId) {
      error(errors, at, "timed/waiting action has no durable schedule");
    }
    if (record.state === "completed") {
      if (!Array.isArray(record.eventIds) || record.eventIds.length === 0) {
        error(errors, at, "completed action has no committed event references");
      } else {
        const durable = new Set((record.durableEvents || []).map((event) => event?.eventId));
        if (record.eventIds.some((id) => !durable.has(id))) {
          error(errors, at, "event references absent from independently read durable log");
        }
      }
    }
    if (typeof record.narration !== "string" || !record.narration.trim()) {
      error(errors, at, "missing player-facing narration/clarification");
    }
    // A model's unverified self-judgment is not a substitute for claim/fact audit.
    if (
      !record.narrationAudit ||
      record.narrationAudit.verified !== true ||
      record.narrationAudit.source !== "independent"
    ) {
      error(errors, at, "missing independently verified narration-to-fact audit");
    }
    const checks = record.probes || {};
    for (const check of beat.checks) {
      const probe = checks[check];
      if (
        !probe ||
        probe.passed !== true ||
        !["db", "api", "mcp", "browser", "clock"].includes(probe.source) ||
        typeof probe.evidenceId !== "string" ||
        !probe.evidenceId.trim()
      ) {
        error(errors, at, "missing/failed authoritative probe " + check);
      }
    }
    if (
      (beat.checks.includes("no_claim_mutation") ||
        beat.checks.includes("no_missing_consumption") ||
        beat.checks.includes("no_overdraft")) &&
      record.mutatedPropertyWithoutCommit === true
    ) {
      error(errors, at, "non-mutating speech/failure changed authoritative property");
    }
    if (
      beat.clock === "real" &&
      (!Number.isFinite(record.elapsedMs) ||
        record.elapsedMs < 1_000 ||
        record.probes.time?.source !== "clock")
    ) {
      error(errors, at, "real-time claim lacks elapsed clock and clock evidence");
    }
  }
  return errors;
}

export function storyCampaignSummary(stories = STORY_CERTIFICATION_CASES) {
  return {
    stories: stories.length,
    acts: stories.reduce((n, story) => n + story.acts.length, 0),
    beats: stories.reduce(
      (n, story) => n + story.acts.reduce((m, act) => m + act.beats.length, 0),
      0,
    ),
    actors: new Set(stories.flatMap((story) => story.players.map((p) => p.id))).size,
    checks: [...new Set(STORY_CERTIFICATION_BEATS.flatMap((beat) => beat.checks))].sort(),
    stage: "specification",
  };
}
