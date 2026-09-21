import { describe, expect, it } from "vitest";
import {
  STORY_CERTIFICATION_BEATS,
  STORY_CERTIFICATION_CASES,
} from "../scripts/ci/story-certification-corpus.mjs";
import {
  auditStoryTranscript,
  storyCampaignSummary,
  validateStoryCorpus,
} from "../scripts/ci/story-certification-audit.mjs";

const story = STORY_CERTIFICATION_CASES[0];

function recordedEvidence(storyCase = story) {
  const worldId = "isolated-test-world";
  const shardId = "isolated-test-shard";
  const players = storyCase.players.map((player) => ({
    alias: player.id,
    userId: "account-" + player.id,
    actorId: "character-" + player.id,
  }));
  const byAlias = new Map(players.map((player) => [player.alias, player]));
  const turns = storyCase.acts
    .flatMap((act) => act.beats)
    .map((beat, index) => {
      const player = byAlias.get(beat.actor)!;
      const requestId = "recorded-request-" + index;
      return {
        beatId: beat.id,
        actor: beat.actor,
        userId: player.userId,
        actorId: player.actorId,
        worldId,
        shardId,
        requestId,
        idempotencyKey: "idempotency-" + index,
        trace: { requestId, actorId: player.actorId, worldId },
        state: "completed",
        eventIds: ["event-" + index],
        durableEvents: [{ eventId: "event-" + index }],
        narration: "Test narration from synthetic evidence, not a live Nocturne response.",
        narrationAudit: { verified: true, source: "independent" },
        elapsedMs: beat.clock === "real" ? 120_000 : 10,
        probes: Object.fromEntries(
          beat.checks.map((check) => [
            check,
            {
              passed: true,
              source: check === "time" ? "clock" : "db",
              evidenceId: "fixture-" + index + "-" + check,
            },
          ]),
        ),
      };
    });
  return { runId: "synthetic-unit-test", worldId, shardId, players, turns };
}

describe("multi-user, original story certification contract", () => {
  it("holds four substantial original stories with 72 nonduplicated player turns", () => {
    const summary = storyCampaignSummary();
    expect(validateStoryCorpus()).toEqual([]);
    expect(summary).toMatchObject({
      stories: 4,
      acts: 12,
      beats: 72,
      actors: 3,
      stage: "specification",
    });
    expect(new Set(STORY_CERTIFICATION_BEATS.map((beat) => beat.id)).size).toBe(72);
  });

  it("covers player-to-player continuity, offline vulnerability, time, money and evidence", () => {
    const checks = new Set(STORY_CERTIFICATION_BEATS.flatMap((beat) => beat.checks));
    for (const required of [
      "concurrency",
      "offline",
      "identity",
      "news",
      "evidence",
      "ownership",
      "no_claim_mutation",
      "no_missing_consumption",
      "no_invention",
      "replay",
      "no_duplicate_payment",
      "schedule",
      "time",
      "physical",
      "terminal_failure",
      "repair",
      "damage",
      "privacy",
      "knowledge",
    ]) {
      expect(checks.has(required), required).toBe(true);
    }
    expect(STORY_CERTIFICATION_BEATS.some((beat) => beat.clock === "real")).toBe(true);
    expect(STORY_CERTIFICATION_CASES.every((storyCase) => storyCase.players.length >= 3)).toBe(
      true,
    );
  });

  it("does not allow the narrative script to be mislabelled as a real passed run", () => {
    const bad = structuredClone(story);
    bad.stage = "passed";
    expect(validateStoryCorpus([bad])).toContain(
      "three-keys: unexecuted stories must remain labelled specification",
    );
  });

  it("rejects missing story characters, prompts, provenance and unsafe replay references", () => {
    const bad = structuredClone(story);
    bad.players.pop();
    bad.acts[0].beats[0].text = "go";
    bad.acts[0].beats[1].checks = ["narration"];
    bad.acts[0].beats[2].clock = "fake";
    bad.acts[0].beats[3].sameKeyAs = "keys-01";
    const errors = validateStoryCorpus([bad]);
    expect(errors.join("\n")).toMatch(/three independent players/);
    expect(errors.join("\n")).toMatch(/not a story player/);
    expect(errors.join("\n")).toMatch(/natural-language player text/);
    expect(errors.join("\n")).toMatch(/mandatory request/);
    expect(errors.join("\n")).toMatch(/real elapsed time/);
    expect(errors.join("\n")).toMatch(/earlier same-actor beat/);
  });

  it("audits all synthetic example records, without claiming live execution", () => {
    expect(auditStoryTranscript(story, recordedEvidence())).toEqual([]);
  });

  it("rejects missing and out-of-order actions rather than skipping difficult story turns", () => {
    const transcript = recordedEvidence();
    transcript.turns.splice(3, 1);
    const errors = auditStoryTranscript(story, transcript).join("\n");
    expect(errors).toMatch(/recorded turn count/);
    expect(errors).toMatch(/missing\/out-of-order beat/);
  });

  it("rejects actor/account impersonation and cross-world evidence", () => {
    const transcript = recordedEvidence();
    transcript.turns[0].userId = "account-dax";
    transcript.turns[1].worldId = "ordinary-player-world";
    transcript.turns[2].trace.actorId = "character-dax";
    const errors = auditStoryTranscript(story, transcript).join("\n");
    expect(errors).toMatch(/authenticated actor or world scope/);
    expect(errors).toMatch(/trace actor\/world scope mismatch/);
  });

  it("rejects missing committed events, ungrounded narration and cosmetic probe passes", () => {
    const transcript = recordedEvidence();
    transcript.turns[0].durableEvents = [];
    transcript.turns[1].narrationAudit.source = "model_self_report";
    transcript.turns[2].probes.schedule.source = "narration";
    transcript.turns[3].narration = "";
    const errors = auditStoryTranscript(story, transcript).join("\n");
    expect(errors).toMatch(/independently read durable log/);
    expect(errors).toMatch(/independently verified narration-to-fact audit/);
    expect(errors).toMatch(/authoritative probe schedule/);
    expect(errors).toMatch(/missing player-facing narration/);
  });

  it("rejects fictional instant time and state mutation from spoken ownership", () => {
    const transcript = recordedEvidence();
    transcript.turns[2].elapsedMs = 0;
    transcript.turns[3].mutatedPropertyWithoutCommit = true;
    const errors = auditStoryTranscript(story, transcript).join("\n");
    expect(errors).toMatch(/real-time claim lacks elapsed clock/);
    expect(errors).toMatch(/non-mutating speech\/failure changed authoritative property/);
  });

  it("rejects a completed action with no events or a waiting action without schedule", () => {
    const transcript = recordedEvidence();
    transcript.turns[0].eventIds = [];
    transcript.turns[1].state = "waiting";
    const errors = auditStoryTranscript(story, transcript).join("\n");
    expect(errors).toMatch(/completed action has no committed event references/);
    expect(errors).toMatch(/timed\/waiting action has no durable schedule/);
  });
});
