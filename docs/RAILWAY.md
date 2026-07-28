# Railway deployment

Create one Railway project with four services sourced from this repository:

1. PostgreSQL
2. `web`
3. `api`
4. `worker`

Use Railway private networking for API, worker, and PostgreSQL communication.

## Variables

Shared:

- `DATABASE_URL`: provided by Railway PostgreSQL.
- `BETTER_AUTH_SECRET`: at least 32 high-entropy characters.
- `BETTER_AUTH_URL`: public web origin.
- `BETTER_AUTH_TRUSTED_ORIGINS`: comma-separated allowed browser origins.
- `OPENROUTER_API_KEY`: added by the repository owner after deployment.
- `OPENROUTER_BASE_URL`: defaults to `https://openrouter.ai/api/v1`.
- `NOCTURNE_AUTHORITATIVE_MODEL`: defaults to `openrouter/free`.
- `NOCTURNE_CREATIVE_MODEL`: defaults to `openrouter/free`.
- `OPENROUTER_HTTP_REFERER`: public Nocturne origin.
- `OPENROUTER_APP_NAME`: `Nocturne`.

Web:

- `NEXT_PUBLIC_API_URL`: public API origin.

API and worker:

- `LOG_LEVEL`
- `PORT` for the API when Railway does not inject it automatically.

## Commands

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

## Migration release step

Run game migrations as an explicit release command before deploying API and worker code that depends on them:

```bash
pnpm db:migrate
```

Better Auth schema changes must also be generated, reviewed, and migrated explicitly. Do not run schema generation automatically during every service boot.
