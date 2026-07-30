# Railway production wiring

Nocturne is a shared pnpm monorepo with separate web, API, and worker services.

## GitHub source settings

For every application service:

- Repository: `michaelhmiv/Nocturne`
- Trigger branch: `main`
- Automatic deployments: enabled
- Wait for CI: enabled after the `CI / validate` workflow is detected
- Config file: `/railway.toml` or the default root config

The repository config intentionally watches all `apps/**`, `packages/**`, and deployment-support files. Shared package changes can affect every service.

## Service commands

- Web build: `pnpm --filter @nocturne/web build`
- Web start: `pnpm --filter @nocturne/web start`
- API build: `pnpm --filter @nocturne/api build`
- API start: `pnpm --filter @nocturne/api start`
- Worker build: `pnpm --filter @nocturne/worker build`
- Worker start: `pnpm --filter @nocturne/worker start`

## Durable AI job variables

Set the same generated secret on API and worker:

- `AI_JOB_WORKER_SECRET`

Set this on the worker with a Railway reference to the API private domain and port:

- `AI_JOB_API_URL=http://${{API.RAILWAY_PRIVATE_DOMAIN}}:${{API.PORT}}`

Replace `API` with the exact Railway API service name if it differs. Both services also require the shared Postgres `DATABASE_URL` reference.

## Migrations

`/railway.toml` runs `node scripts/railway-predeploy.mjs` before deployment. Services with `DATABASE_URL` execute `pnpm db:migrate`; services without it exit successfully. The migration runner holds a PostgreSQL advisory lock, so simultaneous API and worker deploys cannot apply the same migration concurrently.

## Autodeploy troubleshooting

When a `main` commit does not create a deployment:

1. Confirm autodeploy is enabled on each service.
2. Confirm the trigger branch is `main`.
3. Confirm the Railway GitHub App still has access to the private repository and no permission update is pending.
4. Show skipped deployments and check whether old dashboard watch paths excluded the commit.
5. Set the service config file to `/railway.toml` if Railway is using a custom config path.
6. Disconnect and reconnect the repository if webhook delivery remains absent.
