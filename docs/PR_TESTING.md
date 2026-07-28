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

## Authentication changes

Generate and inspect the Better Auth SQL before migration:

```bash
pnpm auth:generate --output /tmp/nocturne-better-auth.sql --yes
pnpm auth:migrate --yes
```

The generated SQL must affect only Better Auth tables. Confirm the applied tables are under `auth`, not `public`, `game`, or `system`. Test sign-up, session retrieval, sign-out, an invalid/expired session, and an untrusted origin. Verify API-side session retrieval works with Node/Fastify headers and shutdown closes the PostgreSQL pool.

## AI changes

The standard suite must use mocked provider calls and must not require a paid key. Test:

- application boot with `OPENROUTER_API_KEY` omitted;
- typed missing-configuration error when an AI operation is invoked;
- malformed JSON and schema-invalid model output;
- timeout and caller abort;
- rate limits and provider errors;
- actual returned model ID capture;
- strict JSON Schema request parameters; and
- rejection of user model overrides for authoritative tasks.

Record whether a live OpenRouter call was performed. A live call is optional for PR #1 and must never replace mocked error-path coverage.

## Rules-engine changes

Add deterministic tests with fixed seeds. Verify identical input/seed output, bounded modifier validation, calculation traces, configurable outcome bands, and non-combat actions.

## Service smoke tests

Build production artifacts, then run web, API, and worker independently. Verify:

- web `/` returns HTTP 200 and renders visibly;
- API `/health` returns HTTP 200;
- API accepts one valid generated-content request and returns structured reasons for an invalid request;
- worker emits `worker_started` and remains alive;
- missing optional OpenRouter configuration does not crash a service;
- missing required auth/database configuration fails clearly when the dependent operation is invoked;
- API and worker handle `SIGTERM`; and
- logs are structured and do not contain secret values.

## Railway/Hermes check

For deployment-affecting changes, have Hermes verify:

- public web and API URLs;
- API health response;
- private PostgreSQL connectivity;
- migrations applied exactly once;
- required variable names are present without printing values;
- web-to-API routing; and
- worker readiness, shutdown, and restart behavior.

Record exact commands, observed results, and anything not run in the PR description. Never imply that local smoke tests constitute a Railway deployment test.
