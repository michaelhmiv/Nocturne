# Pull-request testing

Nocturne uses a manual verification contract rather than a large mandatory GitHub Actions suite.

## Every PR

Run:

```bash
pnpm verify
```

This checks formatting, TypeScript, and unit tests across the workspace.

## Database changes

Also run:

```bash
pnpm --filter @nocturne/database db:check
pnpm db:migrate
```

Review every hand-authored SQL migration. Test both a clean migration and an upgrade from the current `main` schema against a disposable PostgreSQL database. Never edit an already-applied migration; add a new one.

## Authentication changes

Generate and inspect the Better Auth schema/migration. Test sign-up, sign-in, session retrieval, sign-out, expired sessions, and an untrusted origin.

## AI changes

Test with the OpenRouter key omitted, with a valid key, with malformed model output, with a timeout, and with a model that does not support the requested structured-output parameters. Confirm authoritative tasks reject user model overrides.

## Rules-engine changes

Add deterministic tests with fixed seeds. Record the calculation trace and verify outcome-band boundaries.

## API changes

Build the API and smoke-test `/health`, authentication behavior, invalid request bodies, and at least one valid request.

## Railway/Hermes check

For deployment-affecting changes, have Hermes verify:

- all services boot;
- health endpoints respond;
- migrations are applied exactly once;
- required variables are present without printing their values;
- API-to-database private networking works;
- web-to-API routing works; and
- worker shutdown and restart do not duplicate committed events.

Record the commands and observed results in the PR description.
