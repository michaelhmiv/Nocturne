# Nocturne MCP service

The Nocturne MCP service is a remote, OAuth-protected Model Context Protocol endpoint for exercising the game through the same public APIs as the web client. It does not write directly to PostgreSQL.

## Railway service

Create a dedicated Railway service from the repository root with:

- Build command: `pnpm install --frozen-lockfile && pnpm build:mcp`
- Start command: `pnpm start:mcp`
- Healthcheck: `/health`
- Root directory: repository root

Required variables:

- `MCP_PUBLIC_BASE_URL=https://<mcp-domain>`
- `MCP_OAUTH_SIGNING_SECRET=<at least 32 random characters>`
- `MCP_ADMIN_PASSWORD=<strong password entered during ChatGPT OAuth>`
- `NOCTURNE_API_URL=https://nocturneapi-production.up.railway.app`
- `NOCTURNE_API_AUTH_MODE=guest`

Optional variables:

- `MCP_ALLOWED_REDIRECT_HOSTS=chatgpt.com,openai.com,localhost,127.0.0.1`
- `MCP_ACCESS_TOKEN_TTL_SECONDS=3600`
- `MCP_REFRESH_TOKEN_TTL_SECONDS=2592000`
- `MCP_REQUEST_TIMEOUT_MS=120000`

Railway supplies `PORT`. For a non-guest service account, set `NOCTURNE_API_AUTH_MODE=bearer` and `NOCTURNE_API_TOKEN` to a scoped Nocturne agent token.

## ChatGPT authorization

1. In ChatGPT web, enable developer mode for custom apps.
2. Create a custom app and enter `https://<mcp-domain>/mcp` as the MCP endpoint.
3. Select OAuth authentication.
4. Run **Scan Tools**.
5. ChatGPT discovers the protected-resource and authorization-server metadata and dynamically registers an OAuth client.
6. The Nocturne authorization page opens. Enter the value stored in `MCP_ADMIN_PASSWORD`.
7. ChatGPT exchanges the authorization code using PKCE and stores a short-lived access token plus a rotating refresh token.
8. Enable the app in a chat and call `nocturne_health` before gameplay testing.

The service publishes:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-protected-resource/mcp`
- `/.well-known/oauth-authorization-server`
- `/.well-known/openid-configuration`
- `/oauth/register`
- `/oauth/authorize`
- `/oauth/token`
- `/mcp`

Tokens are audience-bound to the MCP endpoint. Access is separated into `nocturne.read` and `nocturne.write` scopes. The authorization server supports PKCE S256, resource indicators, dynamic client registration, refresh tokens, refresh-token rotation, exact redirect validation, and authorization-attempt throttling.

## Tool surface

Player-path tools:

- `create_character`
- `select_character`
- `rent_starter_residence`
- `submit_action`
- `get_scene`
- `get_dashboard`
- `wait_for_dashboard_change`

Inspection tools:

- `nocturne_health`
- `get_world_start`
- `list_characters`
- `list_actions`
- `list_vehicles`
- `get_travel_path`
- `get_operator_dashboard`
- `inspect_world_entity`

`submit_action` accepts natural-language text and optional trace/idempotency metadata. It deliberately does not accept an action kind, destination ID, target ID, route, or handler name. The normal LLM interpretation and persistent-world execution pipeline remains under test.

## Testing discipline

After a write:

1. Read `get_dashboard` and retain its fingerprint.
2. For scheduled work, call `wait_for_dashboard_change`.
3. Read `get_scene`.
4. Read `get_operator_dashboard` for plan, step, schedule, event, and mutation evidence.
5. Use `inspect_world_entity` for any actor, destination, target, item, or vehicle involved.

This makes narration-to-state contradictions visible while preserving the normal gameplay path.

## Starter housing behavior

Character creation atomically provisions a unique bare-bones unit inside Ashdown Apartments in Foundry Row. The building is shared geography, while every apartment is a distinct persistent residence instance. The legacy rent tool is retained as an idempotent repair operation and can no longer fail because another character occupies a different unit.
