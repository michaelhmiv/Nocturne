# Nocturne account and MCP authentication

Nocturne uses Better Auth as the player identity provider. A Better Auth user ID is the authoritative owner key for private player state, characters, inventory, housing, and world membership.

## Browser account flow

The web application supports email/password registration and sign-in through Better Auth. The web and API services must share:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- compatible `BETTER_AUTH_TRUSTED_ORIGINS`

Production must set `NEXT_PUBLIC_NOCTURNE_GUEST_MODE=false` on the web service and `NOCTURNE_GUEST_MODE=false` on the API service. Guest mode is reserved for local development and isolated certification environments.

## ChatGPT MCP account flow

The production MCP connector uses the active Nocturne Better Auth session to authorize one account explicitly:

1. ChatGPT begins OAuth authorization with PKCE.
2. MCP redirects to `/api/mcp/authorize` on the Nocturne web service.
3. The user signs in or creates an account.
4. Nocturne displays the exact account and requires explicit approval.
5. The web service returns a short-lived signed account assertion.
6. MCP embeds the Better Auth user ID and a grant ID into the authorization code.
7. Access and rotating refresh tokens preserve that same account identity.
8. Every MCP tool call receives a newly signed, short-lived Nocturne API credential for that OAuth principal.

The MCP process must never store or mutate a global linked user. `MCP_LINKED_USER_ID` is not supported.

## Durable grant state

Production MCP account linking requires `DATABASE_URL`. PostgreSQL stores:

- the account-bound OAuth grant and its expiration/revocation state
- SHA-256 hashes of one-time authorization codes
- SHA-256 hashes of rotating refresh tokens

Raw authorization codes and refresh tokens are never stored. Access-token validation checks the current grant on every MCP request, so revocation takes effect immediately and survives service restarts or multiple replicas.

Signed-in users manage grants at `/account`. They can revoke one ChatGPT connection or revoke every connection associated with their Better Auth user ID.

## Shared account-link secret

Set the same strong `MCP_ACCOUNT_LINK_SECRET` on the web, API, and MCP services. It authenticates web-to-MCP account assertions and MCP-to-API account credentials.

The MCP service additionally requires:

- `DATABASE_URL`
- `MCP_PUBLIC_BASE_URL`
- `MCP_OAUTH_SIGNING_SECRET`
- `NOCTURNE_WEB_URL`
- `NOCTURNE_API_URL`
- `MCP_ALLOWED_REDIRECT_HOSTS`
- access and refresh token TTL variables as needed

`MCP_ADMIN_PASSWORD` is optional when Nocturne account linking is configured. It exists only for a deliberately configured service-account fallback and is not part of normal player authorization.

## Account isolation requirements

Certification must prove that two users can authorize the same MCP deployment without sharing credentials or private state. Refreshing a token must retain the original user ID. A tool call must generate its upstream API credential from the current OAuth principal, never from process-global state. Code replay, refresh replay, and grant revocation must remain enforced after an OAuth service restart.

## Connector reset

After deploying an OAuth-signing change, rotate `MCP_OAUTH_SIGNING_SECRET` and remove/re-add the ChatGPT custom app. Rotating the signing secret invalidates prior MCP clients, access tokens, and refresh tokens. Do not rotate `BETTER_AUTH_SECRET` as part of a normal MCP reset.
