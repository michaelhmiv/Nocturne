# Signal Garden 5,000-turn certification

Signal Garden is Nocturne's long-form endurance campaign. It is an original urban mystery about a falsified public-information network. Its signature mechanic is a verified public-signal relay: a player must carry a packet with a witness, checksum, and public evidence trail through the city without allowing narration to invent a fact.

The campaign is generated from a seed, so the exact 5,000 turns are reproducible. Three independent authenticated players rotate through the campaign, and the generator rotates all 25 supported action types. The signature relay is represented by a real \`hack\` action with campaign-specific packet data; the campaign state machine records whether the relay was committed, queued, or blocked.

## What the executable runner proves

\`scripts/ci/signal-garden-runner.ts\` runs the generated turns through the compiled API and disposable PostgreSQL database. It:

- provisions three independent agent credentials, characters, and residences;
- submits 5,000 unique commands sequentially through \`/v1/persistent-world/actions\`;
- checks completed, scheduled/waiting, and clarification outcomes;
- checks persistent request, plan, step, schedule, and event evidence at sampled turns and every signature relay;
- samples dashboard and scene reads during the run;
- replays every signature turn plus a deterministic idempotency sample;
- checks cross-account action and dashboard denial;
- verifies unique request/event IDs and aggregate database durability;
- writes a machine-readable report to \`artifacts/signal-garden-5000.json\`.

The runner refuses remote databases and live APIs. CI uses the deterministic provider for the full endurance run. Live provider, production MCP, production smoke, and browser workflows remain separate representative tiers; a green deterministic endurance run is not a claim that 5,000 live model calls were made.

## Coverage model

The campaign is not a random prompt dump. Every turn has:

- a chapter and beat;
- a deterministic player and role;
- one of five story phases;
- a unique packet ID and checksum;
- a concrete action family;
- a state-machine transition;
- an auditable HTTP/database identity.

The contract tests verify reproducibility, uniqueness, all-action coverage, three-player coverage, signature-action semantics, and fail-closed sequence handling. CI runs the contract test alongside the existing 72-beat story manifest and the compiled API endurance run.
