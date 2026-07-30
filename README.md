# Nocturne

Nocturne is a persistent, AI-mediated comic-book role-playing world. Players can invent characters, powers, equipment, vehicles, locations, organizations, and story goals in natural language. The backend captures those ideas through a universal content model rather than a closed catalog.

## Architectural rule

**The AI interprets and narrates. The backend validates, resolves uncertainty, and commits world state.**

Player-created content is represented as:

1. a reusable definition;
2. an immutable definition revision; and
3. a specific world instance when the content exists, is learned, or is installed.

## Repository layout

- `apps/web`: Next.js player client and Better Auth route.
- `apps/api`: authoritative Fastify game API.
- `apps/worker`: background world and AI job runner.
- `packages/contracts`: runtime schemas shared across services.
- `packages/content-engine`: generated-content validation.
- `packages/rules-engine`: deterministic, auditable resolution.
- `packages/database`: Railway PostgreSQL schema and migrations.
- `packages/auth`: Better Auth configuration.
- `packages/event-ledger`: append-only world-event interfaces.

## Local setup

1. Install Node.js 22 or newer and pnpm.
2. Copy `.env.example` to `.env`.
3. Start PostgreSQL and set `DATABASE_URL`.
4. Run `pnpm install`.
5. Run `pnpm db:migrate`.
6. Run `pnpm auth:generate --output /tmp/nocturne-better-auth.sql --yes` and review the SQL.
7. Apply the reviewed Better Auth changes with `pnpm auth:migrate --yes`; the CLI configuration keeps those tables under `auth`.
8. Run `pnpm dev`.

## Pull-request verification

Nocturne intentionally does not depend on a large GitHub Actions pipeline. Before opening or merging a PR, run:

```bash
pnpm verify
```

Run the additional checks applicable to the change in [`docs/PR_TESTING.md`](docs/PR_TESTING.md). A local agent such as Hermes may execute the same checklist against a Railway deployment.

## Agent hookup

External agents (Hermes, bots) use the official Agent API. See [`docs/AGENT_API.md`](docs/AGENT_API.md).

```bash
export NOCTURNE_API_URL=http://localhost:3001
pnpm nocturne:agent bootstrap hermes
pnpm nocturne:agent create-character "Rook" "A courier"
pnpm nocturne:agent rent
pnpm nocturne:agent say "I work a courier gig"
pnpm nocturne:agent status
```

## Status

Phases 1–4 playable loop is in main. Agent gateway + SDK: `@nocturne/agent-sdk`.
