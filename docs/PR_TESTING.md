# Pull-request testing

Nocturne uses a manual verification contract rather than a large mandatory GitHub Actions suite.

## Every PR

From the repository root, run:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm build
```

`pnpm verify` checks formatting, TypeScript, and unit tests across the workspace. The build must also pass because it validates package exports, production bundles, and Next.js route collection.

## Database changes

Use a disposable PostgreSQL database and run:

```bash
pnpm --filter @nocturne/database db:check
pnpm db:migrate
pnpm db:migrate
```

Confirm the second migration run is a no-op. Temporarily changing an already-recorded migration must produce `Applied migration <name> has been modified`; restore the file immediately after this checksum test.

Review every hand-authored SQL migration. Test both a clean migration and, after `main` has a deployed schema, an upgrade from that schema. Never edit a migration already applied outside a disposable database; add a new migration.

For immutable tables, verify PostgreSQL rejects updates/deletes of definition revisions and ledger events. Confirm foreign keys are validated, expected lookup indexes exist, JSONB is retained for extensible payloads, and timestamps use `timestamptz`.

For conversational persistence, verify one transaction commits each resolved step's event/audit and state operations or none of them. Test idempotency scoped by authenticated user and conversation under retry and concurrency; the same key with different immutable request fields (normalized text or protocol version) must return a conflict, and the same key used by another user or conversation must not collide. Later authoritative world-state changes must not alter replay identity. If a compound message fails after an earlier step commits, verify the committed prefix persists and retry resumes or returns it without duplication. Refresh and service restart must preserve conversation, character, definitions/revisions/instances, location, knowledge, timed work, costs, consequences, and events.

## Authentication changes

Generate and inspect the Better Auth SQL before migration:

```bash
pnpm auth:generate --output /tmp/nocturne-better-auth.sql --yes
pnpm auth:migrate --yes
```

The generated SQL must affect only Better Auth tables. Confirm the applied tables are under `auth`, not `public`, `game`, or `system`. Test sign-up, session retrieval, sign-out, an invalid/expired session, and an untrusted origin. Verify API-side session retrieval works with Node/Fastify headers and shutdown closes the PostgreSQL pool.

## AI and conversational-engine changes

The standard suite must use mocked provider calls and must not require a paid key. Test:

- typed missing-configuration error when an AI operation is invoked;
- malformed JSON and schema-invalid model output;
- timeout, caller abort, rate limits, and provider errors;
- actual returned model ID and prompt-policy-version capture;
- strict JSON Schema request parameters;
- rejection of user model overrides for authoritative tasks;
- ordinary messages for pre-character dialogue, conversational character creation, questions, inventions, actions, and out-of-character discussion without mode fields;
- unusual concepts map to general mechanics rather than detection-only code or a generic `invalid_request`;
- every proposed factor and operation precondition cites a supplied backend fact ID;
- fabricated, stale, inaccessible, conflicting, uncited, or visibility-invalid facts fail closed;
- the viewpoint proposal is produced from player-known facts only, the authoritative pass cannot rewrite its apparent probability or visible reasoning, and player-known/authoritative-hidden facts remain separate through proposal, audit, API response, history, logs exposed to players, and narration;
- narration uses only committed player-safe results, adds no mechanics or knowledge, gives no canned next-step coaching, and falls back safely after provider failure; and
- provider/system failure before commit does not masquerade as an in-world outcome.

## Probability and rules-engine changes

Test the versioned `nocturne-probability-v1` scale from [Conversational engine](CONVERSATIONAL_ENGINE.md):

- only integer basis points from `0` through `10000` are accepted;
- every band boundary and the special `impossible=0` and `certain=10000` values;
- exact band membership and rejection of gaps, overlaps, fractions, NaN, and out-of-range values;
- apparent probability and visible reasoning use only player-known cited facts;
- authoritative probability may differ only when cited hidden facts support it, and neither the difference nor hidden adjustment is present in player-safe output;
- hidden safeguards can resolve as separate hidden reactions without contaminating the displayed probability;
- identical stable inputs and server seed produce the same roll/result, while changed seeds preserve bounds and expected distribution;
- the model cannot provide, select, observe, or reroll the seed;
- meaningful compound actions execute ordered checks, refresh context between commits, and stop/branch after an outcome makes later steps impossible; and
- deterministic sample runs meet documented statistical tolerances for representative probabilities.

Do not preserve detection-score behavior merely because old tests assert it. Surveillance and detection remain valid scenario inputs, not privileged resolution architecture.

## Location, presence, and timed-work changes

Against disposable PostgreSQL, verify:

- each character has exactly one authoritative current physical location;
- movement is atomic, event-backed, and updates affected-set queries in event order;
- `located_within` ancestry includes occupants of nested rooms/units in an area effect while excluding adjacent places;
- tenancy, ownership, or access does not imply physical presence;
- another player's exact location is absent from player-safe state without direct observation or a valid information asset;
- disconnecting leaves a character present and eligible for observation and area effects;
- offline characters perform no autonomous actions;
- only explicit committed timed work advances offline, with recorded objective, scope/location, timing, reserved resources, and interruption rules;
- the worker does not invent follow-up choices when timed work completes or is interrupted; and
- concurrent movement, timed completion, and area effects resolve from fresh state without duplicate or stale operations.

## Conversational acceptance gate

Run the acceptance flow through the API or thin CLI before frontend redesign, then repeat it through the browser when the frontend is connected:

1. Start a fresh conversation with no character and create one through ordinary dialogue.
2. Describe an unusual invention without selecting a mode or calling a player-facing normalize/install workflow.
3. Resolve its attempt, costs/time, acquisition, and placement through the conversation.
4. If acquisition permits, immediately use it in the next ordinary message.
5. Observe the exact apparent probability, player-known cited factors, player-safe roll/outcome, costs, consequences, information, state changes, and event IDs; verify the authoritative audit exists separately and hidden facts do not leak.
6. Refresh the client and compare conversation, character, invention, instance, location, knowledge, costs, consequences, and events.
7. Restart API, worker, and web processes and compare the same state again.
8. Replay an earlier idempotency key and confirm the original response returns with no duplicate character, item, cost, work record, or event.

Also run a hidden-safeguard scenario, a nested-location area effect that includes an offline character without inventing their action, provider/narration failure, transaction rollback, and two concurrent users sharing a location.

The gate fails if the flow requires an Invent/Act mode, character form, install button, client-supplied authoritative actor/method/target choice, detection-specific action path, or frontend game logic. It also fails on generic novelty rejection, hidden-fact leakage, unauthorized state, a partial commit within one resolved step, duplicate event, invented offline action, lost restart state, or canned next-step coaching.

## Thin-client contract

Run the same scripted transcript through the CLI and frontend against the same conversational API. Exact-result equality uses the same identity and idempotency keys so the second client replays the committed result. Independent fresh-world executions assert schema and authority parity rather than identical random draws. Inspect clients to confirm they contain transport/rendering only: no intent classification, probability derivation, operation construction, authorization, randomness, state mutation, or hidden-fact redaction. The dashboard must issue read-only state/history requests.

## Service smoke tests

Build production artifacts, then run web, API, and worker independently. Verify:

- web `/` returns HTTP 200 and renders visibly;
- API `/health` returns HTTP 200;
- the API accepts one valid conversational message and returns typed reasons for an invalid proposal or request;
- worker emits `worker_started` and remains alive;
- missing required auth/database configuration fails clearly when the dependent operation is invoked;
- API and worker handle `SIGTERM`; and
- logs are structured, contain no secret values, and do not expose authoritative-hidden facts to player-visible channels.

## Railway/Hermes check

For deployment-affecting changes, have Hermes verify:

- public web and API URLs;
- API health response;
- private PostgreSQL connectivity;
- migrations applied exactly once;
- required variable names are present without printing values;
- web/CLI-to-API routing through the same conversational contract;
- worker readiness, shutdown, restart, and explicit timed-work behavior; and
- the complete conversational acceptance gate, including refresh/restart persistence and idempotent replay.

Record exact commands, observed results, live model IDs when used, sanitized event/audit IDs, and anything not run in the PR description. Never imply that local smoke tests constitute a Railway deployment test.
