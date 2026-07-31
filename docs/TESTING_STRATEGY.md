# Nocturne gameplay certification

Nocturne is not considered deployable because the code compiles or because Railway reports a healthy container. A release is certifiable only when the production-built browser can submit gameplay through the real Next.js gateway, the compiled API routes the request to the intended persistent-world handler, PostgreSQL records the expected durable state, structured telemetry proves each lifecycle stage, and asynchronous work resumes exactly once.

## Governing rule

A capability does not exist until all of the following are present and passing:

1. A typed capability-registry entry.
2. Deterministic unit and integration scenarios.
3. Authoritative database assertions and invariants.
4. Structured telemetry assertions.
5. A browser-path scenario when the capability is player-facing.
6. Worker restart/retry coverage when the capability is asynchronous.

Adding a new `ActionType` without adding `ACTION_CAPABILITIES[actionType]` is a compile failure. Adding a cross-cutting mechanic requires a `SYSTEM_CAPABILITIES` entry and its scenario/invariant contract.

## Certification layers

### Pull-request certification

`.github/workflows/ci.yml` is the required PR gate. Nothing is advisory.

- **Format** — Prettier must pass.
- **Typecheck** — every workspace TypeScript project must pass.
- **Unit and telemetry** — package tests, capability completeness, and telemetry schemas must pass.
- **Production build** — every workspace package must build in production mode.
- **Database** — migration validation, clean migration, repeated migration, and authoritative invariants run against PostgreSQL 16.
- **Action matrix** — all 25 supported action types are sharded across eight jobs and must satisfy their declared outcome, log, state, and negative-case contracts.
- **Compiled API integration** — a production-built API talks to a deterministic OpenAI-compatible provider and PostgreSQL. Every action is submitted over HTTP and checked against stored request, plan, step, event/receipt, schedule, idempotency, and failure state.
- **Browser action matrix** — Chromium loads the production-built Next.js app, creates a character, rents the starter residence, and submits every action through the visible composer. Legacy route traffic, HTTP 500 responses, console errors, and generic internal errors fail the run.
- **Required Gate** — fails when any dependency fails, is cancelled, or is skipped.

### Nightly exhaustive certification

`.github/workflows/nightly-exhaustive.yml` runs one action per shard, the complete workspace verification, and clean/repeated migrations against PostgreSQL 15, 16, and 17.

Nightly is the appropriate home for later expansion into:

- generated paraphrase matrices;
- randomized deterministic seeds;
- concurrent idempotency races;
- browser matrices for Firefox and WebKit;
- worker termination and restart during claimed work;
- database connection interruption;
- long multi-player and multi-turn scenarios;
- prior-release database upgrade fixtures.

### Live provider contract

`.github/workflows/provider-contract.yml` performs two minimal real structured-output calls against the configured provider: one authoritative and one creative. It verifies authentication, model availability, endpoint compatibility, JSON mode, thinking configuration, and schema validation without mutating world state.

Repository configuration:

- Variables: `AI_PROVIDER`, `AI_MODEL`, `AI_AUTHORITATIVE_MODEL`, `AI_CREATIVE_MODEL`, `AI_BASE_URL`, `AI_THINKING_MODE`, `AI_JSON_MODE`, `AI_SEND_TEMPERATURE`, `AI_MAX_TOKENS`, `AI_TIMEOUT_MS`.
- Secret: `AI_API_KEY`, or the applicable provider-specific secret.

### Production deployment smoke

`.github/workflows/deployment-smoke.yml` waits for the deployed commit and executes black-box observation and consumption requests through the public web gateway using a dedicated CI actor.

Required repository configuration:

- Variable `NOCTURNE_API_URL`.
- Variable `NOCTURNE_WEB_URL`.
- Variable `NOCTURNE_SMOKE_CHARACTER_ID`.
- Secret `NOCTURNE_SMOKE_AGENT_TOKEN`.

The smoke actor must be isolated from normal gameplay. It should be disposable or assigned to a dedicated certification world when multi-world test isolation is available.

## Deterministic provider

`scripts/ci/fake-ai-provider.ts` implements the OpenAI-compatible chat-completions contract used by Nocturne. It records every request and response in NDJSON and returns strict fixtures for:

- entity-reference interpretation;
- persistent-world planning;
- legacy action intent parsing;
- consumable analysis;
- search/discovery analysis;
- committed-event narration;
- provider contract probes.

Failure markers allow deterministic validation of provider error handling:

- `[fake:429]`
- `[fake:500]`
- `[fake:timeout]`
- `[fake:empty]`
- `[fake:invalid-json]`

No PR-required test calls a live AI provider.

## Telemetry contract

Every gameplay lifecycle record is validated by `GameplayTelemetryEventSchema`. Records include, where applicable:

- trace, request, plan, step, schedule, event, and mutation-receipt identifiers;
- world, shard, user, and actor scope;
- action kind, action type, and handler;
- provider, model, provider request, attempt, and duration;
- stable error code;
- whether authoritative state was committed.

A failed telemetry event without a stable error code is invalid. A step event without a step ID is invalid. A provider failure that claims committed state is invalid.

The minimum successful synchronous sequence is:

1. `request_received`
2. `scope_resolved`
3. `context_compilation_started`
4. `context_compilation_completed`
5. `reference_resolution_started`
6. `provider_call_started`
7. `provider_call_completed`
8. `reference_resolution_completed`
9. `plan_created`
10. `step_claimed`
11. `handler_started`
12. `handler_completed`
13. `event_committed`
14. `step_completed`
15. `request_completed`

Waiting actions replace terminal event/step/request completion with `schedule_created`, `step_waiting`, and `request_waiting` until authoritative continuation completes.

## Database invariants

`pnpm --filter @nocturne/database db:invariants` currently checks:

- applied migration history exists;
- live entities have world and shard scope;
- one active exclusive physical plan exists per actor;
- completed requests have player-safe results;
- completed plans contain only terminal steps;
- resolved schedules have result events;
- resolving schedules have valid workers and leases;
- append-only protection triggers remain enabled.

Every new durable mechanic must add at least one invariant when invalid state can be expressed in SQL.

## Adding an action

1. Add the action to the domain action union.
2. Add its exhaustive `ACTION_CAPABILITIES` entry.
3. Add canonical browser prompts.
4. Add deterministic provider classification/fixtures.
5. Add state assertions to compiled API integration.
6. Add applicable database invariants.
7. Add all outcome grades for contested actions.
8. Add negative provider, authorization, stale-state, and idempotency cases.
9. Add worker coverage when the action can wait or schedule continuation.
10. Confirm the browser test renders the result without legacy traffic or generic errors.

## Required branch protection

Protect `main` and require `Certification / Required Gate`. Direct pushes and administrator bypass should not be used for normal development. Provider and production smoke workflows are release certification signals; they should become required deployment checks after their repository variables and dedicated credentials are configured.

## Failure artifacts

Failed jobs retain the relevant subset of:

- formatting, typecheck, unit, build, and migration logs;
- API, web, and fake-provider NDJSON;
- action integration results;
- telemetry validation report;
- database invariant report;
- Playwright HTML report, traces, screenshots, and browser output;
- live provider contract response metadata;
- production smoke output.

A useful failure identifies the capability, action, trace, request, last completed stage, stable error code, and whether any authoritative state was committed. `internal_error` alone is not an acceptable diagnosis.
