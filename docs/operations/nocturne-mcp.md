# Nocturne MCP service

The Nocturne MCP service is a remote, OAuth-protected Model Context Protocol endpoint that exercises the game through the same authenticated public APIs as the web client. It never writes directly to game tables.

## Railway service

Use the repository root with:

- Build command: `pnpm install --frozen-lockfile && pnpm build:mcp`
- Start command: `pnpm start:mcp`
- Healthcheck: `/health`

Required production variables:

- `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- `MCP_PUBLIC_BASE_URL=https://<mcp-domain>`
- `MCP_OAUTH_SIGNING_SECRET=<independent secret of at least 32 characters>`
- `MCP_ACCOUNT_LINK_SECRET=<shared account-link secret of at least 32 characters>`
- `NOCTURNE_WEB_URL=https://<web-domain>`
- `NOCTURNE_API_URL=https://<api-domain>`
- `NOCTURNE_API_AUTH_MODE=bearer`
- `MCP_ALLOWED_REDIRECT_HOSTS=chatgpt.com,openai.com,localhost,127.0.0.1`

Optional token settings:

- `MCP_ACCESS_TOKEN_TTL_SECONDS=3600`
- `MCP_REFRESH_TOKEN_TTL_SECONDS=2592000`
- `MCP_REQUEST_TIMEOUT_MS=120000`

Do not configure `MCP_LINKED_USER_ID`. Account identity is selected during OAuth and is stored in each durable grant. `MCP_ADMIN_PASSWORD` and `NOCTURNE_API_TOKEN` are only for an explicitly configured service-account fallback and are not used by the normal player-account flow.

The web, API, and MCP services must use the same `MCP_ACCOUNT_LINK_SECRET`. The MCP and web services must use the same PostgreSQL database so users can list and revoke connector grants.

## Account authorization

1. ChatGPT discovers the OAuth metadata and dynamically registers a public client.
2. MCP redirects the browser to `/api/mcp/authorize` on the Nocturne web service.
3. The user signs in or creates a Better Auth account.
4. Nocturne displays the exact signed-in account and requires explicit consent.
5. The web service returns a short-lived signed account assertion to MCP.
6. MCP creates a PostgreSQL-backed OAuth grant and one-time authorization-code record.
7. ChatGPT exchanges the code with PKCE and receives an access token plus a rotating refresh token.
8. Every MCP request verifies that the grant remains active and creates a short-lived upstream API credential for that user only.

Authorization codes and refresh tokens are stored only as SHA-256 hashes. Code consumption, refresh rotation, expiration, and revocation survive MCP restarts and multiple service replicas.

## User revocation

Signed-in users manage connections at `/account`. They can revoke one ChatGPT grant or every active grant. Revocation immediately invalidates existing MCP access tokens and prevents future refreshes.

## Administrative roles

New world memberships default to `player`. Role elevation is explicit and audited:

```bash
DATABASE_URL=... pnpm world:grant-role player@example.com operator
```

The command resolves the Better Auth account by exact email, updates only that user’s default-world membership, and records the prior and new role in `auth.admin_audit_log`.

## Connector reset after OAuth changes

After deploying an OAuth-signing or grant-format change:

1. Rotate `MCP_OAUTH_SIGNING_SECRET` on the MCP service.
2. Confirm MCP `/health` reports `oauthStorage: postgres` and `apiIdentityMode: per_user`.
3. Remove the old Nocturne custom app from ChatGPT.
4. Add the MCP endpoint again and rescan tools.
5. Sign in to Nocturne and explicitly authorize the displayed account.

Do not rotate `BETTER_AUTH_SECRET` during a normal MCP reset.

## Tool surface

Player-path tools include character creation and selection, starter housing repair, natural-language action submission, scene inspection, dashboard inspection, and dashboard-change waiting. Inspection tools include health, world start, characters, actions, vehicles, travel paths, operator traces, and world-entity inspection.

`submit_action` accepts natural-language intent rather than internal action kinds or entity-routing parameters. After each write, inspect the dashboard, scene, operator traces, and relevant entities to confirm that narration matches durable state.
