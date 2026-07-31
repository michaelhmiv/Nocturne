# Agent API

First-class hook for external agents (Hermes, custom bots) to play Nocturne like a user on the site.

## Auth model

| Method          | Header                             | Notes                                          |
| --------------- | ---------------------------------- | ---------------------------------------------- |
| **Agent token** | `Authorization: Bearer noct_agt_…` | Preferred. Isolated `userId` per token.        |
| Session cookie  | Better Auth                        | Human browser users                            |
| Guest           | `x-nocturne-guest-mode: 1`         | Dev/local only when `NOCTURNE_GUEST_MODE=true` |

Tokens are **hashed at rest** (`sha256`). Plaintext is returned **once** at mint/bootstrap.

### Bootstrap (device pairing)

```http
POST /v1/agent/bootstrap
{ "label": "hermes-home" }
```

Allowed when:

1. `NOCTURNE_AGENT_BOOTSTRAP_KEY` is set **and** request sends matching `x-nocturne-bootstrap-key`, or
2. Key unset **and** (`NOCTURNE_GUEST_MODE=true` **or** `NOCTURNE_AGENT_OPEN_REGISTRATION=true`)

Creates `userId = agent:<uuid>` + token.

**Prod recommendation:** set `NOCTURNE_AGENT_BOOTSTRAP_KEY` and turn off open guest agent pairing for public surfaces.

### Mint under existing identity

```http
POST /v1/agent/tokens
Authorization: Bearer … | session | guest
{ "label": "secondary", "boundCharacterId": null }
```

## Play endpoints

All accept agent token (or session/guest). Bound character is used when `characterId` omitted.

| Method     | Path                       | Purpose                                           |
| ---------- | -------------------------- | ------------------------------------------------- |
| GET        | `/v1/agent/me`             | Token / user identity                             |
| GET        | `/v1/agent/status`         | Cash, heat, skills, inventory, character          |
| POST       | `/v1/agent/characters`     | `{ name, conceptSummary, bind? }`                 |
| GET        | `/v1/agent/characters`     | List                                              |
| POST       | `/v1/agent/bind`           | `{ characterId }`                                 |
| POST       | `/v1/agent/rent`           | Starter residence                                 |
| POST       | `/v1/agent/act`            | `{ text }` freeform action (site chat equivalent) |
| GET        | `/v1/agent/history`        | Recent actions                                    |
| GET        | `/v1/agent/market`         | Listings                                          |
| POST       | `/v1/agent/market/buy`     | `{ listingId }`                                   |
| GET        | `/v1/agent/vehicles`       | Available + owned                                 |
| POST       | `/v1/agent/vehicles/claim` | `{ vehicleId }`                                   |
| GET/DELETE | `/v1/agent/tokens`         | Manage                                            |

Existing `/v1/*` routes also accept agent Bearer tokens via shared `requireUser`.

## SDK

```ts
import { NocturneAgent } from "@nocturne/agent-sdk";

const agent = new NocturneAgent({
  baseUrl: process.env.NOCTURNE_API_URL!,
  token: process.env.NOCTURNE_AGENT_TOKEN,
});

// first time:
// await agent.bootstrap("hermes");

await agent.createCharacter({ name: "Rook", conceptSummary: "Street courier" });
await agent.rent();
const status = await agent.status();
const result = await agent.act("I work a courier gig");
```

## CLI

```bash
export NOCTURNE_API_URL=https://nocturneapi-production.up.railway.app
pnpm nocturne:agent bootstrap hermes
pnpm nocturne:agent create-character "Rook Vale" "A courier who sees too much"
pnpm nocturne:agent rent
pnpm nocturne:agent status
pnpm nocturne:agent say "I carefully check the alley for cameras"
```

Config default: `~/.config/nocturne/agent.json` (mode 0600).

## Hermes skill

Load skill `nocturne` (gaming). It uses `NOCTURNE_API_URL` + `NOCTURNE_AGENT_TOKEN` and the official endpoints above — not ad-hoc guest curls.

## Migrations

Agent tokens require `0009_agent_tokens.sql`. Run:

```bash
pnpm db:migrate
```
