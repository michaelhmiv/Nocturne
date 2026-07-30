# Nocturne Conversational Core Implementation Plan

> **For Hermes:** Use subagent-driven-development to implement this plan task-by-task with strict RED-GREEN-REFACTOR. Do not resume frontend redesign until the backend acceptance gate passes.

**Goal:** Replace Nocturne's form-shaped vertical slice with one tested conversational game command path that can create characters, invent arbitrary content, resolve general actions with LLM-proposed probabilities, preserve viewpoint-limited knowledge, and commit persistent multiplayer world state.

---

## Product contract and hard boundaries

- Nocturne is an AI GM running a persistent multiplayer comic-book world.
- All gameplay and character creation use one natural-language conversation. Invent/Act modes do not exist.
- The dashboard is read-only.
- The GM infers whether input is character creation, dialogue, a question, an invention attempt, a world action, or out-of-character discussion.
- Unusual actions are mapped to general mechanics rather than rejected for lacking bespoke code.
- Anything may be attempted. Skill, resources, time, location, known and hidden circumstances, and consequences determine the outcome.
- For each meaningful uncertain step, the LLM proposes structured probability and reasoning; the backend validates cited facts, allowed ranges, authorization, and proposed operations before performing the authoritative roll.
- Player-facing results show the exact final probability and roll. Hidden safeguards may alter authoritative resolution or create latent reactions, but their identities and individual adjustments are not disclosed.
- The player learns only facts their character successfully observes, infers, or is told.
- Physical location is authoritative. Logging out does not move or protect a character. The character performs no autonomous actions while absent except explicitly committed timed work.
- Responses do not contain canned next-step advice or suggestions.

## Current-state audit

### Reuse

- `definition -> revision -> instance` persistence model.
- `game.entity_instances.location_id` as the single current physical location.
- `located_within` relations and starter location instances as the initial place hierarchy.
- Separate residence occupancy from physical presence.
- Append-only `game.event_ledger`, AI-run audit records, idempotency pattern, and atomic action commits.
- General content vocabulary: traits, effects, requirements, costs, limitations, risks, signatures, counters, modes, relationships, and extension payloads.
- Existing authentication and same-origin API proxy.

### Replace or extend

- `POST /v1/actions` currently requires frontend-selected actor/method/target IDs and rejects every action except `detect` against one seeded alley. It cannot be the conversational command path.
- `action-service.ts` calculates a detection score in code and permits only small LLM modifiers. The clarified contract requires an LLM probability proposal validated by the backend.
- Invention normalization and installation are separate player-operated endpoints. Conversation must orchestrate attempt, time/cost, creation, placement, and immediate use naturally.
- Character creation and apartment rental are separate forms/buttons rather than GM conversation outcomes.
- Public context is currently a hard-coded alley object. It needs fact IDs, provenance, visibility, place containment, owned capabilities, current conditions, and relevant hidden facts.
- Location exists but has no general movement command, affected-set query, recursive containment test, or area-event handling.
- Calculation traces currently expose authoritative score details. They need separate full audit and player-safe views.
- Existing tests pass compilation and isolated helpers but do not execute the deployed character -> invention -> use flow, real database action commits, arbitrary action interpretation, location effects, hidden safeguards, or live conversational behavior.

## Phase 0: Freeze the architecture in repository documentation

**Objective:** Prevent future agents from rebuilding the wrong product.

**Files:**

- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/VERTICAL_SLICE.md`
- Modify: `docs/PR_TESTING.md`
- Create: `docs/CONVERSATIONAL_ENGINE.md`

**Work:**

- Document the single conversational command path, public/hidden context boundary, apparent versus authoritative probability, fact-ID citations, operation allowlist, location/presence semantics, offline behavior, timed work, and narration boundary.
- Replace the surveillance-array-only definition of the first vertical slice with the approved conversational acceptance flow.
- State that the CLI and frontend are clients of the same API and contain no adjudication logic.
- Record a versioned probability scale and its allowed ranges before prompts or contracts depend on it.

**Acceptance:** A new implementer can explain the complete message -> proposal -> validation -> roll -> commit -> narration flow and identify which data is player-visible without reading chat history.

## Phase 1: Establish executable conversational contracts

**Objective:** Define one stable schema shared by the LLM, backend, CLI, and later frontend.

**Files:**

- Create: `packages/contracts/src/conversation.ts`
- Modify: `packages/contracts/src/action.ts`
- Modify: `packages/contracts/src/resolution.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/conversation-contracts.test.ts`

**Work:**

- Add a single message request containing conversation/session identity and raw text; actor is backend-selected when one exists.
- Define internal intent categories without exposing UI modes.
- Define versioned fact references with IDs, source entity/event, visibility, and provenance.
- Define one or more sequential checks for compound actions, each containing objective, known-information assessment, authoritative probability proposal, public and hidden fact citations, stakes, possible outcomes, and proposed state operations.
- Represent probability as integer basis points to avoid floating-point ambiguity.
- Extend the operation allowlist minimally for character creation, entity creation/acquisition, movement, relationships/access, conditions/resources, information assets, timed work, and area effects.
- Separate full authoritative audit from player-safe resolution details.
- Bound message length, check count, operation count, text lengths, and probability ranges at the trust boundary.

**Tests (RED first):**

- Accept ordinary chat messages with no actor/method/target mode fields.
- Reject malformed probabilities, unknown operation types, excessive check/operation counts, and uncited factors.
- Preserve hidden/public visibility in authoritative records while proving player-safe schemas cannot contain hidden facts.
- Represent a compound room search as ordered checks without requiring predefined door/search action enums.

**Acceptance:** Contracts can express character creation, a strange invention, immediate use, hidden door safeguards, movement, building fire effects, dialogue, questions, and out-of-character input without adding a new action type for each verb.

## Phase 2: Build the universal probability validator and deterministic roller

**Objective:** Make LLM-proposed probabilities bounded, auditable, reproducible, and safe.

**Files:**

- Create: `packages/rules-engine/src/probability.ts`
- Modify: `packages/rules-engine/src/index.ts`
- Retire after migration: `packages/rules-engine/src/score-derivation.ts`
- Test: `packages/rules-engine/test/probability.test.ts`
- Test: `packages/rules-engine/test/probability-distribution.test.ts`

**Work:**

- Encode the documented difficulty bands and valid basis-point ranges.
- Validate that every proposed factor cites a supplied fact ID and that visible reasoning cites only player-known facts.
- Validate proposed probability against the selected band and bounded factor adjustments.
- Keep both apparent and authoritative probability; expose the exact final probability while retaining hidden factors and individual adjustments only in the authoritative audit.
- Derive randomness from the server resolution secret plus stable event inputs. The LLM never sees or chooses the seed.
- Return a percentile roll, success/failure, margin, and outcome grade without narration.
- Support hidden reactions as separately validated checks/operations rather than forcing every safeguard into the visible lock-picking percentage.

**Tests (RED first):**

- Boundary tests for every probability band and basis-point edge.
- Same inputs and seed produce exactly the same roll/result.
- Changed seed changes samples while preserving bounds.
- Invalid fact IDs, hidden facts in visible reasoning, NaN/fractional values, and out-of-band proposals fail closed.
- A visible 85% lock-picking assessment can coexist with an undisclosed alarm reaction.
- Statistical sanity test across many deterministic seeds confirms observed outcomes remain within a documented tolerance for representative probabilities; this verifies the roller rather than testing the LLM.
- Outcome-grade and consequence mapping at extremes and boundaries.

**Acceptance:** The backend can prove why it accepted a probability proposal, reproduce the roll, and emit a player-safe trace without revealing hidden safeguards.

## Phase 3: Build authoritative context and knowledge boundaries

**Objective:** Give the adjudicator enough world truth to reason while giving the player only legitimately known information.

**Files:**

- Create: `packages/database/src/context-store.ts`
- Create: `apps/api/src/context-service.ts`
- Modify: `packages/database/src/index.ts`
- Add migration: next immutable migration after `0003_consequential_actions.sql`
- Test: `packages/database/test/context-store.integration.test.ts`
- Test: `apps/api/test/context-service.test.ts`

**Work:**

- Reuse `entity_instances.location_id` for exact physical presence and `located_within` for place ancestry.
- Add missing self-reference/index/constraints required for reliable location queries without introducing a second location model.
- Build recursive containment queries: current place, ancestors, descendants, occupants inside a place, and affected entities at an event timestamp.
- Keep residence rights/access distinct from physical location.
- Build relevant context from controlled character, current place, inventory/owned instances, known information assets, conditions, relationships, and nearby observable entities.
- Supply relevant hidden facts to the authoritative adjudicator with visibility labels; never send unrelated world secrets.
- Use opaque fact IDs so LLM proposals cite backend facts rather than copying arbitrary strings.
- Add player-safe redaction as one shared backend function used by API, CLI, history, and frontend.

**Database tests against disposable PostgreSQL:**

- Exactly one current physical location per character.
- Moving between nested places is atomic and event-backed.
- Residence tenancy does not imply current physical presence.
- Descendant query includes occupants in units/rooms for a building-level event and excludes adjacent places.
- Concurrent movement and area-event commits resolve in authoritative event order.
- Offline characters remain present and are included in affected sets.
- One player cannot query another player's exact location without an information asset or direct observation.
- Idempotent replay does not duplicate movement, effects, or events.
- Clean migration, upgrade migration, second-run no-op, checksum protection, foreign keys, indexes, and rollback on failed operations.

**Acceptance:** A building fire can determine its affected set correctly while a searching player still cannot obtain a building roster.

## Phase 4: Replace detection-only parsing with structured GM adjudication

**Objective:** Let the LLM interpret unlimited natural-language interactions through one constrained schema.

**Files:**

- Replace/extend: `packages/ai-gm/src/action-adjudicator.ts`
- Create: `packages/ai-gm/src/conversation-adjudicator.ts`
- Modify: `packages/ai-gm/src/index.ts`
- Test: `packages/ai-gm/test/conversation-adjudicator.test.ts`
- Test: `packages/ai-gm/test/viewpoint-boundary.test.ts`

**Work:**

- Prompt the authoritative model to infer intent, decompose only meaningful uncertain steps, propose probability bands/basis points, cite fact IDs, define stakes, and propose allowlisted operations.
- Do not prompt next steps, prescribe player actions, or reject novelty merely because it lacks a named mechanic.
- Let ambiguity create assumptions and uncertain consequences unless commitment is impossible.
- Require separate known and hidden reasoning fields and prohibit hidden text from player-facing output.
- Preserve provider/model/run audit metadata.
- Remove deterministic surveillance-specific fallback from production paths. Test fallback may return fixture proposals only when explicitly enabled.

**Mocked-provider tests:**

- Character concept inferred from ordinary conversation.
- Invention attempt inferred without an Invent mode.
- Immediate use of a newly created item.
- Dialogue, question, hypothetical, and out-of-character input do not accidentally commit actions.
- Compound room-to-room search decomposes into sequential consequential checks.
- Door pick with hidden alarm keeps public reasoning clean.
- Weaker character attacking stronger character produces fact-cited probability reasoning.
- Unsupported/crazy concepts map to general effects instead of `invalid_request`.
- Fabricated facts, unauthorized targets, hidden-fact leaks, malformed JSON, schema-invalid output, excessive checks, provider timeout/429/5xx, and model override attempts fail safely.
- GM narration ends naturally and contains no canned next-step coaching.

**Acceptance:** A large corpus of arbitrary inputs can be represented by the same schema without adding bespoke code for each action verb.

## Phase 5: Create the single conversational command service

**Objective:** Orchestrate interpretation, validation, rolls, operations, persistence, and narration through one backend entry point.

**Files:**

- Create: `apps/api/src/conversation-service.ts`
- Create: `packages/database/src/conversation-store.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/invention-service.ts` to expose reusable internal operations rather than player workflow steps
- Modify: `packages/database/src/invention-store.ts`
- Modify: `packages/database/src/action-store.ts` or replace it after behavior parity
- Test: `apps/api/test/conversation-service.test.ts`
- Test: `apps/api/test/conversation.integration.test.ts`

**Work:**

- Add `POST /v1/conversations/:id/messages` and read endpoints for history/player-safe dashboard data.
- Select the authenticated user's active character server-side; allow pre-character conversation.
- Execute ordered checks sequentially, refreshing authoritative context between committed checks and stopping when failure/consequence makes later steps impossible.
- Reuse content normalization to create definitions/revisions, but resolve acquisition through the universal action pipeline. Do not require the user to normalize and then click Install.
- Commit character creation, invention results, movement, costs, information, latent reactions, timed work, and narration linkage through the event ledger.
- Validate ownership, access, resources, affected targets, and operation targets immediately before commit.
- Persist the full authoritative audit and separately generate/store player-safe history.
- Make idempotency cover the complete message so retries return the original committed sequence.
- Return typed, useful GM failures instead of generic `invalid_request`; provider/system failures must not masquerade as in-world outcomes.

**Integration tests against disposable PostgreSQL:**

- Conversational character creation persists and becomes active.
- Arbitrary invention success, partial success, failure, costs, and timed research.
- Immediate use of a newly created usable instance.
- Refresh/restart preserves conversation, definitions, instances, location, knowledge, and events.
- Idempotent retries create no duplicate character/item/event/cost.
- Failed validation rolls back unauthorized or malformed operations.
- Narration failure preserves committed mechanics and uses a safe factual fallback.
- Concurrent users interact with the same location without stale affected sets.
- Hidden alarm commits without leaking until discovered/notified.
- Offline character is affected by a building event without the GM inventing an action for that character.

**Acceptance:** The first required flow works entirely through one API message endpoint with no mode fields or follow-up installation endpoint required from the client.

## Phase 6: Add the thin interactive/scriptable CLI

**Objective:** Make conversational behavior easy to explore and reproduce without frontend noise.

**Files:**

- Create: `scripts/nocturne-cli.ts`
- Create: `scripts/nocturne-scenario.ts`
- Modify: root `package.json`
- Create: `test/scenarios/*.jsonl`
- Test: `test/cli.test.ts`

**Work:**

- Use installed `tsx`, Node `readline`, and native `fetch`; add no CLI framework.
- Send raw messages to the conversational API and print narration, exact final probability, visible factors, roll, costs, state changes, and event IDs.
- Support developer-only inspection commands for player-safe state/history and an opt-in authoritative trace when running locally.
- Accept base URL, conversation ID, and session cookie through arguments/environment; never embed credentials.
- Script JSONL transcripts with assertions so a failed creative flow is immediately reproducible.
- Keep all game logic on the server.

**Acceptance:** Interactive and scripted clients produce the same API results, and deleting the CLI would not remove any game capability.

## Phase 7: Backend-heavy verification gate

**Objective:** Prove logical behavior before any frontend redesign.

### Automated gate

Run uncached tests where supported, plus:

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @nocturne/database db:check
pnpm db:migrate
pnpm db:migrate
```

Required scenario coverage:

1. Conversational character creation with incomplete, ambiguous, exotic, and mundane concepts.
2. Inventions across technology, magic, weapons, vehicles, biological changes, surveillance, defenses, tools, organizations, and projects.
3. Success, partial success, failure, hidden consequence, timed work, insufficient resources, and unauthorized attempts.
4. Immediate use of inventions whose acquisition result permits it.
5. Ordinary actions with no specialized mechanic: doors, climbing, persuasion, repair, concealment, travel, observation, and environmental manipulation.
6. Compound actions that must stop or branch after an earlier roll.
7. Known versus hidden safeguards and player-safe trace redaction.
8. Nested locations, movement, occupancy/capacity, area effects, offline characters, and concurrent multiplayer actions.
9. PvP probability proposals grounded in both characters' authoritative capabilities.
10. Refresh, service restart, retry/idempotency, narration failure, provider failure, and transaction rollback.

### Probability verification

- Boundary tests for every scale band.
- Deterministic replay tests for representative probabilities.
- Large deterministic sample runs with explicit statistical tolerances.
- Confirm apparent and authoritative probabilities diverge only when supported by cited hidden facts.
- Confirm no probability proposal is accepted with fabricated/missing citations or outside configured bounds.

### Live-model exploratory gate

Using the CLI against the real authoritative model:

- Run multiple fresh conversational sessions rather than one golden path.
- Exercise at least fifty natural-language turns spanning character creation, unusual inventions, immediate use, movement, hidden safeguards, dialogue, compound actions, location effects, and multiplayer conflict.
- Include adversarial phrasing, typos, ambiguity, contradictory requests, extreme power claims, and attempts to obtain hidden information.
- Save sanitized JSONL transcripts and authoritative audit IDs for every failure.
- Turn every discovered defect into a failing automated regression test before fixing it.
- Repeat the affected live scenario after the fix.

The gate fails if any tested creative input produces a generic `invalid_request`, leaks hidden facts, commits unauthorized state, duplicates events, invents an offline character action, or requires a frontend mode selection.

## Phase 8: Minimal frontend reconnection only after the gate passes

**Objective:** Make the browser a thin client of the proven conversational API.

**Files:**

- Modify: `apps/web/app/game-client.tsx`
- Modify: `apps/web/app/game-state.ts`
- Modify: `apps/web/app/styles.css` only as needed
- Test: existing web tests plus one conversational transport/render test

**Work:**

- Remove Invent/Act modes, character-creation form, rent/install workflow buttons, and scripted next-step guidance.
- Keep one composer and conversation timeline.
- Keep a separate read-only dashboard using player-safe backend state.
- Do not duplicate classification, probability, or state-transition logic in React.

**Acceptance:** The exact CLI acceptance scenarios can be repeated through the browser with identical committed results.

## Phase 9: Deployment and final evidence

**Objective:** Verify the real Railway system, not only local builds.

**Work:**

- Use a fresh `feat/*` branch and the required feat -> beta -> main PR flow.
- Apply the new migration as a release step and verify the second run is a no-op.
- Verify API/web/worker health, private database connectivity, variables by name only, logs, restart persistence, and no secret leakage.
- Execute the first acceptance flow on Railway through the CLI/API and browser:
  1. Create a character conversationally.
  2. Invent an unusual item.
  3. Immediately use it.
  4. Observe probability, visible reasoning, roll, costs, consequences, and state changes.
  5. Refresh and restart services.
  6. Confirm persistence and idempotent replay.
- Execute one hidden-safeguard scenario and one nested-location/area-effect multiplayer scenario.
- Update PR body with exact commands, results, live model IDs, sanitized event/audit IDs, failures found and fixed, and anything not run.
- Verify CI, squash-merge through beta/main workflow, then repeat production smoke tests on the merged SHA.

## Definition of done

Implementation is not complete until all are true:

- One natural-language API message path handles pre-character conversation, character creation, inventions, ordinary actions, questions/dialogue, and immediate use.
- No client chooses Invent versus Act or supplies authoritative method/target IDs.
- LLM probability proposals are fact-cited, range-validated, deterministically rolled, fully audited, and safely redacted.
- Hidden safeguards can affect outcomes without leaking through displayed reasoning.
- Physical location, containment, offline presence, movement, and area effects are database-authoritative and concurrency-tested.
- Conversation, events, inventions, knowledge, locations, costs, and consequences persist across refresh and service restart.
- Automated unit, mocked-AI, real-PostgreSQL integration, concurrency, probability-sampling, scripted CLI, and live-model exploratory gates pass.
- At least fifty live natural-language turns have been exercised and every discovered defect has a regression test.
- The browser is reconnected only after backend/CLI acceptance passes.
- Railway acceptance passes after merge; no generic `invalid_request`, hidden leak, unauthorized write, or duplicated event remains in the tested flows.

## Explicitly skipped until evidence requires them

- Graph databases, spatial engines, map rendering, room generation for every building, and per-verb action classes.
- A terminal UI framework or separate CLI game implementation.
- Autonomous player-character behavior while users are absent.
- Frontend polish before the conversational backend is proven.
- Specialized combat/economy/location subsystems that the universal adjudication schema already handles adequately.
