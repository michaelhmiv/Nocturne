# Isolated certification inspection: first security boundary

This is a **read-only, short-lived inspection capability**, not operator access and not a completed multi-user certification environment. The original 15-case live suite and all 72 story beats are still unverified.

## Present capability

Migration 0038 creates short-lived isolated certification runs and SHA-256 hashed inspector credentials. The API accepts an additional credential **only** on `GET /v1/certification/world/entities/:entityId`, in the `x-nocturne-certification-token` header. It does not recognize the credential in player auth, ordinary operator inspection, repairs, MCP tools, or any mutation endpoint. Each credential belongs to exactly one run, world and shard, expires in at most two hours, and is invalidated by grant/run revocation, expired timestamps, inactive world/shard, or an absent `isolatedCertification` world marker. Default shared-world access is structurally forbidden.

The inspector derives scope solely from the hashed credential lookup. A caller cannot select another run/world/shard, and an entity from outside the grant scope returns `entity_not_found`. Accepted, missing-in-scope and expired/revoked reads are audited by grant/run ID, world/shard and requested entity ID; no raw token is stored or logged. An unknown token has no persisted run to attribute and fails as `403`.

## Offline issuance and revocation

The script `scripts/ci/provision-certification-inspection.ts` requires database credentials, `NOCTURNE_CERT_PROVISION=1`, and an **absolute** `NOCTURNE_CERT_TOKEN_OUTPUT` file path. It creates a new world/shard/run and mints a one-purpose random token, stored only as a SHA-256 digest in PostgreSQL. It writes the plaintext token one time to a new mode-0600 file and prints only run/world/shard IDs and expiration. Keep the file outside the repository and CI artifacts; inject it through a trusted secrets boundary once the live runner exists. Remove the file after passing the credential to the authorized process. `NOCTURNE_CERT_TTL_MINUTES` accepts 1–90.

`scripts/ci/revoke-certification-inspection.ts` requires `NOCTURNE_CERT_REVOKE=1` and `NOCTURNE_CERT_RUN_ID`. Revoke after every run; expiry is a second backstop. Revocation retains the run audit and does not clean up game assets, alter a public player membership, or delete unrelated data.

**Do not run a live story against a newly issued world yet.** It has deliberately not been seeded with starter streets/housing. Legacy character creation, starter housing SQL and player scope resolution still hard-code the default world. Making these world-aware, provisioning three distinct *player* identities, and binding those identities to the isolated run are separate prerequisites before issue #138 can close. The inspector token by itself cannot perform gameplay.

## Mandatory test boundaries

PostgreSQL tests seed two truly separate certification worlds and two grants, then inspect one scoped entity per run. They check cross-run, cross-shard/default-world denial, unknown/malformed/expired/revoked credentials, operator/repair separation, and audit records. Fastify route tests verify that an ordinary player cannot substitute a session for the inspector token; the token does not authorize operator entity inspection or repair; no POST certification repair route exists. Both tests run under regular required CI. No skipped test or static fixture makes the 15-case live suite green.
