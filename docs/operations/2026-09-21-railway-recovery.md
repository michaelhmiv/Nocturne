# Nocturne Railway recovery — September 21, 2026

## Environment and revision

Project: `bb436905-bd68-486d-b091-376d30d47a8e`; production environment: `881b221e-01c9-4830-a717-e6ea9a50dc06`. Initial application release is `main` commit `3f5fff0b12438d2220f71cba538c3086bc300a47`; PR #136 must not be described as deployed until its exact merged SHA is verified.

| Component           | Railway service                 | Public origin                                   |
| ------------------- | ------------------------------- | ----------------------------------------------- |
| PostgreSQL          | `Postgres`                      | Internal networking only                        |
| API                 | `@nocturne/api`                 | `https://nocturneapi-production.up.railway.app` |
| Web                 | `@nocturne/web`                 | `https://nocturneweb-production.up.railway.app` |
| Worker              | `@nocturne/worker`              | No public domain                                |
| MCP                 | `nocturnemcp`                   | `https://nocturnemcp-production.up.railway.app` |
| Geospatial importer | `@nocturne/geospatial-importer` | One-shot only                                   |

## Recovery accomplished

The new Postgres service uses persistent storage. The API and worker share its internal `DATABASE_URL` reference; application migrations were observed through `0036_world_scoped_event_idempotency.sql`. A separate migration-only run reported successful Better Auth migration. Distinct long random secrets were configured for web/API authentication, game resolution/rolls, and worker communication; MCP account-linking uses a shared secret between the MCP, web, and API services. Secret values must never appear in documentation or CI logs.

The repository's old `railway.toml` config-file setting was rejected by Railway as deprecated. API, web, and worker instead have explicit service-level pre-deploy command `node scripts/railway-predeploy.mjs` and shared-monorepo watch patterns. New code must not assume `/apps/api/**` alone catches package changes.

## Remaining release gates

- Configure `OPENROUTER_API_KEY` separately on Railway services requiring model calls. The GitHub Actions secret is not automatically available in Railway. A green `/health` does not establish a green `/ready` or successful live gameplay.
- Certify Better Auth sign-up/session, website, API readiness, MCP OAuth/account linking, worker behavior, and exact deployment SHA with live requests. A Railway successful deployment status alone does not certify all flows.
- The importer must retain `pnpm --filter @nocturne/geospatial-importer start` with restart policy `NEVER`, and must not be launched until an approved source dataset and import limit are established. Its temporary migration-runner configuration was removed.
- Merge PR #136 only after all required deterministic and live Jev/Laguna checks pass on the exact final head SHA. Laguna narration remains presentation-only.
- Before major import or migration changes, take and verify a PostgreSQL backup and rehearse restore to staging.

## Provider and production rules

Jev makes bounded typed semantic decisions. Deterministic code and PostgreSQL own truth, mechanics and state. Laguna XS narrates committed player-safe facts. No generative fallback interprets player commands and no post-narration Jev verification is used. Avoid conflating passing CI on a feature branch with a deployed or working production game.
