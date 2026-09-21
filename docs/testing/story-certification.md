# Multi-user story certification: Nocturne must play like a coherent game

The 15-case production MCP regression suite checks specific failures. It is necessary but not sufficient. A persistent-world text MMO must also survive a **sustained story with independently authenticated characters**, offline time, competing observations, a real physical world, dialogue, money, property and consequences. JSON schema compliance is not story quality, and fluent prose is not evidence of state mutation.

## Status

The four original crime-drama scenarios in [story-certification-corpus.mjs](../../scripts/ci/story-certification-corpus.mjs) comprise **12 acts / 72 player beats / 3 recurring characters**. They are marked **specification**, not “tested” or “passed.” CI presently certifies the manifest shape and the fail-closed evidence auditor only. It does **not** execute the 72 beats against the live game, does **not** attest to actual live Jev/Laguna performance, and does **not** satisfy production release criteria by itself.

Issue #138 must deliver an isolated certification world, separate real account grants, scoped read-only inspection, and safe test provisioning. Until then, do not turn shared-world player signups into operators, put diagnostic tools on the public player MCP endpoint, run destructive story actions on real player property, or synthesize passing evidence.

## First executable story path

The separate required CI job **Certification / Three-Account Story Smoke** exercises the opening with three real independently signed-up Better Auth accounts, selected characters and distinct starter units against a fresh PostgreSQL container and a compiled API. It submits real natural-language actions with deterministic Jev/Laguna stand-ins; it queries persistent request/plan/event/receipt rows and rejects cross-account dashboard and actor access. Replays must return the exact original request and event IDs. This is a substantial improvement over mocked session assertions, but **it is not a live OpenRouter story, does not test the full 72 beats, and does not establish production readiness**. The full long-form runner still requires issue #138.

## Fiction and characters

Write **original GTA-inspired urban crime drama**, not pasted fan fiction or scripts from other games. The script's scene descriptions are prompts for the test _operator_, not reality injected into the game. An act must never predeclare that there is a key, an arsonist, a paid job, a gun, an operable car, a chair or a witness unless real seeded/committed world facts establish it. A story can be compelling when an attempted action fails, a witness is mistaken, a route is blocked, or a character has to work around circumstances.

The recurring independently authenticated accounts are:

- **Mara Velez**: cautious tenant, shopper, possible vehicle owner.
- **Dax Mercer**: impulsive neighbor and gig worker.
- **Imani Brooks**: observant neighbor, witness and offline tenant.

The four release narratives are _Three Keys on Hester Street_ (residences/claims/pronouns/routes), _The Last Shift at Orchard Market_ (jobs, trading, competition and wages), _Smoke on the Block_ (offline consequences, damage, investigation and repairs), and _The Blue Sedan and the Wrong Man_ (unique ownership, mistaken identity, evidence, news and replay).

Use fictionally named locations and people on the NYC-derived physical graph. The test should adapt to actual accessible fixtures and existing routes instead of conjuring a preferred object to force a pass.

## Required live runner, not yet implemented

1. **Provision** a fresh isolated certification world and shard, three distinct Better Auth user accounts, three separate OAuth/MCP grants and a character/unit for each. No shared cookie jar. Persist sanitized run ID and actor IDs. Record the exact deployed service SHAs, schema revision, provider versions and start time. Never infer isolation from a test email prefix.
2. **Seed only declared fixtures** through an auditable test-only world-setup operation. Store their IDs, owner, precise current location, accessible routes, stock/price if any, and source. Mark any story beat that depends on an unavailable capability blocked/failed, not passed. Do not invent the fixture in the prose or model response.
3. **Capture before snapshots** of authoritative entities, relationship edges, resources, schedules, character state, known facts and event cursor from the isolated world. Save independent per-account views. Enforce stable world/shard and ownership scopes.
4. **Act in character**, submitting each beat's natural-language text through the same public website composer/API or ordinary player MCP endpoint used by real players. Rotate the three independent session credentials and submit concurrent turns simultaneously when the story requires a real race. Preserve per-turn idempotency keys.
5. **Capture after snapshots** from the same privileged _scoped read-only_ inspector, not from narration. Fetch request, plan, steps, schedules, events, receipts, entity versions, history and observable player scene/dashboard. Every timed action waits on actual elapsed wall-clock time; fake timers belong only in separate unit tests.
6. **Audit causality and cross-view consistency.** The character may know only what they directly experienced or learned through permitted communication. Other players' scenes must reflect globally committed public changes; hidden facts stay hidden. A stated ownership claim does not change title. A missing sandwich cannot be consumed. One car has one owner. Work pays once, after actual completion. A fire and theft remain after logout/recovery.
7. **Audit Laguna separately.** Archive exact committed player-safe facts supplied to narration, raw Laguna text, deterministic fallback usage and every material claim. An independent evaluator extracts factual claims and compares them with eligible committed facts and that player's knowledge boundary. Claims about ownership, injury, money, time, culprit identity, object existence and location need explicit support. Human review samples prose for readability, pacing, repetition, character continuity and emotional credibility; a model's unsupported “looks good” judgment is not evidence.
8. **Certify the real outcome.** Emit one record per beat with authenticated user/actor/world/shard IDs, request/plan/step/schedule/event/receipt IDs, raw sanitized evidence artifacts, probe results, narration-claim audit and actual timestamps. Feed it to the corpus evidence auditor. Never let missing actions, missing logs, empty snapshots, 403s, unexpected provider responses or skipped beats become a green report.
9. **Challenge and vary.** Rerun each act with paraphrased commands, different legitimate character choices, alternate seeded conditions, conflicting same-item requests, interrupted work, worker restart, offline intervals and adversarial identity/ownership claims. Record seeds. A narrative arc is a family of trajectories; success is state-consistent play, not a prewritten winning ending.
10. **Publish the game transcript.** A sanitized chronological “novella” shows scene context, each actor's command, actual narration and only permitted state changes. Adjacent to each chapter publish compact state diffs and links to trace/event receipts so a reviewer can follow **what happened**, **who knew it**, **why**, and **whether it persists after a different user acts**.

## Release evaluation

**Three independent verdicts** are required: (1) semantic intent/reference/action correctness; (2) deterministic authoritative-world invariants and cross-actor consistency; (3) Laguna prose fidelity and story quality. Neither one may compensate for another. A beautiful story with a duplicated paycheck or fictional gunshot fails.

Every beat requires a recorded request, trace, narrative text and at least two domain-specific authoritative checks. The static auditor verifies evidence completeness, scope, identity, linked durable event IDs, explicit real-time proof and independently reviewed narration. The actual runner must additionally implement each probe against raw database/API/MCP/browser artifacts; merely setting a probe's passed flag does not establish the fact.

When a capability is genuinely missing, mark the story **not ready** and retain its failing scenario as an acceptance test for that feature PR. Do not lower assertions, seed imaginary success, or filter out its beats to create a misleading green release. The 72-beat story suite becomes a required end-to-end release gate after the isolated live runner exists, alongside the original 15 live regressions.

## Expected growth

Add at least 20 paraphrases per core mechanism, 100+ random but valid seeds per story, a multi-hour endurance playthrough, simultaneous actor actions, credential/session expiration, post-restart recovery, interruptions, malicious instruction attempts inside dialogue, and mobile/desktop website sessions. The full test budget must report per-action correctness, story consistency defect counts, Jev/Laguna p50/p95/p99 latency, cost, schedule drift and player-facing prose samples. Do not replace these with deterministic fake-provider numbers: maintain both the deterministic suite and a separately labelled live-model/live-deployment suite.
