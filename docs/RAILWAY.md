# Railway deployment

Create one Railway project with four services sourced from this repository:

1. Railway PostgreSQL
2. `web`
3. `api`
4. `worker`

Keep each code service's **root directory at the repository root**. Workspace packages are shared, so using `apps/web`, `apps/api`, or `apps/worker` as a Railway root directory will break workspace dependency resolution.

Use Railway private networking for PostgreSQL. Set each code service's `DATABASE_URL` from the PostgreSQL service's private/internal connection variable; do not use the public TCP proxy for service-to-database traffic. Give `web` and `api` public Railway domains. The worker has no public domain.

## Variables

Web:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`: at least 32 high-entropy characters; use the same value on web and API.
- `BETTER_AUTH_URL`: public HTTPS web origin, with no trailing path.
- `BETTER_AUTH_TRUSTED_ORIGINS`: comma-separated public web origin and any explicitly permitted development origins.
- `NEXT_PUBLIC_API_URL`: public HTTPS API origin.

API:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `BETTER_AUTH_TRUSTED_ORIGINS`
- `LOG_LEVEL`: defaults to `info`.
- `PORT`: Railway normally injects this.

Worker:

- `DATABASE_URL`
- `LOG_LEVEL`: defaults to `info`.

Server-side AI variables for API/worker services that invoke AI:

- `OPENROUTER_API_KEY`: optional at boot; AI operations return a typed configuration error while absent.
- `OPENROUTER_BASE_URL`: defaults to `https://openrouter.ai/api/v1`.
- `NOCTURNE_AUTHORITATIVE_MODEL`: defaults to `openrouter/free`; never accept a user override for authoritative tasks.
- `NOCTURNE_CREATIVE_MODEL`: defaults to `openrouter/free`.
- `OPENROUTER_HTTP_REFERER`: public Nocturne web origin.
- `OPENROUTER_APP_NAME`: `Nocturne`.

Never expose `DATABASE_URL`, `BETTER_AUTH_SECRET`, or `OPENROUTER_API_KEY` through `NEXT_PUBLIC_*` variables.

## Service commands

Use the repository root for all commands. A single install command is sufficient per build environment:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Web:

```bash
pnpm --filter @nocturne/web build
pnpm --filter @nocturne/web start
```

API:

```bash
pnpm --filter @nocturne/api build
pnpm --filter @nocturne/api start
```

Worker:

```bash
pnpm --filter @nocturne/worker build
pnpm --filter @nocturne/worker start
```

Do not configure both repository-level and service-level build paths for the same service.

## Migration release step

Run migrations as an explicit release step before deploying API or worker code that depends on them:

```bash
pnpm --filter @nocturne/database db:check
pnpm db:migrate
```

For Better Auth changes, generate SQL against the target Better Auth version, review it, then use the schema-aware CLI configuration to migrate:

```bash
pnpm auth:generate --output /tmp/nocturne-better-auth.sql --yes
# Review /tmp/nocturne-better-auth.sql. It must contain only Better Auth tables.
pnpm auth:migrate --yes
```

The Better Auth adapter adds `search_path=auth,public`; `pnpm auth:migrate` therefore creates auth tables in `auth`. Do not apply generated, unqualified SQL with a plain `psql -f` command unless `search_path` is explicitly set to `auth,public`.

Never run schema generation or migrations automatically during every service boot.

## Health checks and restarts

- API health path: `/health`; expect HTTP 200 and `{ "status": "ok", "service": "api" }`.
- Web health path for the foundation: `/`; expect HTTP 200.
- Worker readiness: successful PostgreSQL connectivity followed by a structured `worker_started` log. The foundation worker intentionally has no HTTP server.
- API handles `SIGTERM`, stops accepting requests, and closes an opened Better Auth PostgreSQL pool.
- Worker handles `SIGTERM`, clears its heartbeat, closes PostgreSQL, logs `worker_stopping`, and exits.
- Use Railway's default restart-on-failure behavior. Do not run multiple worker replicas until job claiming and idempotency are implemented and tested.

## Deployment validation

A Railway deployment was not part of PR #1's local foundation validation. Before production use, have Hermes verify the public web/API URLs, private PostgreSQL connectivity, migrations, health checks, restart behavior, and service logs without printing secret values.
