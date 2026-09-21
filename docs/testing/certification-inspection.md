# Isolated certification inspection: first security boundary

This is a **read-only, short-lived inspection capability**, not operator access and not a completed multi-user certification environment. The original 15-case live suite and all 72 story beats are still unverified.

## Present capability

Migration 0038 creates short-lived isolated certification runs and SHA-256 hashed inspector credentials. The API accepts an additional credential **only** on `GET /v1/certification/world/entities/:entityId`, in the `x-nocturne-certification-token` header. It does not recognize the credential in player auth, ordinary operator inspection, repairs, MCP tools, or any mutation endpoint. Each credential belongs to exactly one run, world and shard, expires in at most two hours, and is invalidated by grant/run revocation, expired timestamps, inactive world/shard, or an absent `isolatedCertification` world marker. Default shared-world access is structurally forbidden.

The inspector derives scope solely from the hashed credential lookup. A caller cannot select another run/world/shard, and an entity from outside the grant scope returns `entity_not_found`. Accepted, missing-in-scope and expired/revoked reads are audited by grant/run ID, world/shard and requested entity ID; no raw token is stored or logged. An unknown token has no persisted run to attribute and fails as `403`.

## Offline issuance and revocation

The script `scripts/ci/provision-certification-inspection.ts` requires database credentials, `NOCTURNE_CERT_PROVISION=1`, and an **absolute** `NOCTURNE_CERT_TOKEN_OUTPUT` file path. It creates a new world/shard/run and mints a one-purpose random token, stored only as a SHA-256 digest in PostgreSQL. It writes the plaintext token one time to a new mode-0600 file and prints only run/world/shard IDs and expiration. Keep the file outside the repository and CI artifacts; inject it through a trusted secrets boundary once the live runner exists. Remove the file after passing the credential to the authorized process. `NOCTURNE_CERT_TTL_MINUTES` accepts 1–90.

`scripts/ci/revoke-certification-inspection.ts` requires `NOCTURNE_CERT_REVOKE=1` and `NOCTURNE_CERT_RUN_ID`. Revoke after every run; expiry is a second backstop. Revocation retains the run audit and does not clean up game assets, alter a public player membership, or delete unrelated data.

**Do not run a live story against a newly issued world yet.** It has deliberately not been seeded with starter streets/housing. Legacy character creation, starter housing SQL and player scope resolution still hard-code the default world. Making these world-aware, provisioning three distinct _player_ identities, and binding those identities to the isolated run are separate prerequisites before issue #138 can close. The inspector token by itself cannot perform gameplay.

## Server-bound player identities (follow-up boundary)

An isolated inspection token is NEVER used as a player's authentication. A separate `game.certification_players` record can bind an ordinary authenticated user ID to the exact run/world/shard under a composite foreign key. This record may be created only through trusted, offline database provisioning; names, email prefixes, HTTP headers, a `worldId` query parameter, and public MCP tools cannot grant access. The authenticated player scope resolver reads the run binding directly from PostgreSQL and verifies the run's active status, expiration, world marker, shard and **player-only** membership. It does not auto-enroll bound users into the public world.

A bound account remains bound after its run expires or is revoked: subsequent gameplay fails closed instead of falling back into production. Until genuinely isolated character creation and housing land, all historical default-world character creation, listing, selection and starter rental methods refuse a bound certification account. The compiled API three-identity test adds a fourth real credential and confirms that it cannot create or list public-world characters or acquire an unintended public membership.

**Binding is not enabled for live story runs yet.** This step does not create Better Auth accounts, certification-world housing, routes or NPCs, nor does it grant an inspector token the ability to play. The outstanding #138 work is trusted onboarding provisioning for three normal OAuth player identities, physically isolated starter geography and units, and the live 15-case and 72-turn acceptance suites.

## Isolated physical story fixture (database-only)

Migration 0041 introduces two **privileged database fixture functions**, not player-facing routes: `game.provision_certification_district(run_id)` seeds a fictional five-place location hierarchy with its own UUIDs, world/shard, containment, and a traversable building–alley route; `game.provision_certification_player(run_id,user_id,name)` checks the exact persisted player binding and PLAYER membership, then creates a unique character, bare-bones apartment, occupancy, apartment-door route and **world/shard-scoped append-only character and housing events**. The run row is locked, so retries return the original actor and residence rather than duplicating housing or payroll. No public-world asset is referenced, and a revoked/expired run cannot provision even an existing character.

Required PostgreSQL tests assert three distinct independent players, apartments, events, access routes and no default-world membership/character, cross-run denial, idempotent retries and revocation. The disposable compiled API test also creates **three independently authenticated isolated players** and attempts one real non-mutating action each, verifying request/plan/event scopes and cross-actor/world denial; public ordinary players retain their earlier six-turn integration scenario. A fake AI provider is still used. This is neither production OAuth enrollment nor the full 72-turn live Jev/Laguna campaign.

The isolated fixture intentionally models a **small certification district**, not the full NYC map. It must not be confused with a complete importer or a finished economy. The scene can legitimately reject an unavailable knife, food or car. Those rejections become part of later long-form story acceptance rather than grounds for inventing props.

## Mandatory test boundaries

PostgreSQL tests seed two truly separate certification worlds and two grants, then inspect one scoped entity per run. They check cross-run, cross-shard/default-world denial, unknown/malformed/expired/revoked credentials, operator/repair separation, and audit records. Fastify route tests verify that an ordinary player cannot substitute a session for the inspector token; the token does not authorize operator entity inspection or repair; no POST certification repair route exists. Both tests run under regular required CI. No skipped test or static fixture makes the 15-case live suite green.
