# Migration 0013 append-only backfill

Migration `0013_world_and_shard_scope.sql` adds world and shard scope to existing authoritative rows.

Some historical tables use user triggers to enforce append-only behavior. The migration therefore disables user triggers only for the duration of the scope backfill, restores them before completing, and relies on PostgreSQL transactional DDL so a failed migration restores both data and trigger state.

The selected-character foreign key is also guarded through `pg_constraint` so retries remain idempotent after interrupted deployments.
