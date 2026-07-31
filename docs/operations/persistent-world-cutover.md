# Persistent-world production cutover

This procedure replaces Nocturne's prototype mutation paths with the shared persistent-world runtime. It preserves authentication and user accounts. Prototype gameplay data is retained through a verified Railway/PostgreSQL backup and an in-database archive schema before activation.

## Preconditions

1. Merge the persistent-world PR stack in order.
2. Confirm GitHub Actions passes formatting, typecheck, tests, build, and clean-database migration tests.
3. Create and verify a Railway/PostgreSQL backup.
4. Confirm API, worker, and web are deployed from the same commit.
5. Confirm the worker uses the existing `AI_JOB_WORKER_SECRET` and private `AI_JOB_API_URL`.
6. Keep `persistent_world_runtime` disabled.
7. Run shared-world smoke tests against the deployed code while legacy mutation routes remain enabled.

## Prepare

Set:

```text
DATABASE_URL=<production database>
NOCTURNE_WORLD_BACKUP_REFERENCE=<verified Railway backup/snapshot reference>
NOCTURNE_CUTOVER_OPERATOR=<operator user ID>
CONFIRM_NOCTURNE_WORLD_CUTOVER=RESET_NOCTURNE_PERSISTENT_WORLD_V1
```

Run:

```text
pnpm tsx scripts/cutover-persistent-world.ts prepare
```

Preparation:

- takes a PostgreSQL advisory lock;
- creates a timestamped archive schema;
- copies every `game` table containing `world_id` for the production world;
- records the external backup and archive schema in `game.world_state_archives`;
- leaves the persistent runtime disabled;
- leaves legacy mutation routes enabled.

Do not activate if the archive record, table counts, or external backup cannot be verified.

## Production smoke suite

Before activation, validate at minimum:

1. One command creates exactly one durable action request.
2. Idempotent replay returns the same request/result.
3. Search failure creates no entity.
4. Successful bounded search creates or reveals one entity.
5. The same entity ID remains after travel, containment, and later reference.
6. Two plausible entities force clarification.
7. Travel produces a waiting plan and authoritative scheduled arrival.
8. Worker restart does not duplicate arrival.
9. Arrival resumes the dependent plan only after context/version revalidation.
10. A companion cohort moves together; an entity left at home remains there.
11. Hidden facts do not appear in the scene projection.
12. Operator inspection can trace provenance, relations, events, plans, schedules, and context inclusion.
13. Operator repair produces a normal compensating event or mutation receipt.
14. Severe offline PvP and irreversible PvP remain disabled.

## Activate

Run:

```text
pnpm tsx scripts/cutover-persistent-world.ts activate
```

Activation sets:

```text
persistent_world_runtime.enabled = true
legacyMutationRoutesEnabled = false
severeOfflinePvpEnabled = false
irreversiblePvpEnabled = false
```

The public client should then use:

```text
GET  /v1/persistent-world/scene
POST /v1/persistent-world/actions
```

Legacy mutation routes must reject writes after the feature state is observed. Read-only compatibility may remain temporarily for diagnostics.

## Rollback

Run:

```text
pnpm tsx scripts/cutover-persistent-world.ts rollback
```

Rollback immediately disables the persistent runtime and marks legacy mutation routes available. This is an application-level rollback. A full data rollback must use the verified PostgreSQL backup or the archive schema under an explicit restoration procedure.

Never manually edit entity JSON as the primary repair mechanism. Use operator inspection and compensating events so state changes remain auditable.
