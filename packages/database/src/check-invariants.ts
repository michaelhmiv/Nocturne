import { createDatabase } from "./index.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for invariant checks.");

const database = createDatabase(databaseUrl);

async function requireZero(label: string, query: Promise<unknown[]>) {
  const rows = await query;
  if (rows.length > 0) {
    throw new Error(`${label} failed with ${rows.length} violating row(s): ${JSON.stringify(rows.slice(0, 10))}`);
  }
  console.log(`PASS ${label}`);
}

try {
  const migrations = await database.client<{ count: string }[]>`
    SELECT count(*)::text AS count FROM system.schema_migrations
  `;
  const migrationCount = Number(migrations[0]?.count || 0);
  if (migrationCount < 1) throw new Error("No applied migrations were recorded.");
  console.log(`PASS applied migrations (${migrationCount})`);

  await requireZero(
    "world and shard scope on live entities",
    database.client`
      SELECT instance_id
      FROM game.entity_instances
      WHERE world_id IS NULL OR shard_id IS NULL
      LIMIT 20
    `,
  );

  await requireZero(
    "one active exclusive physical plan per actor",
    database.client`
      SELECT world_id, shard_id, actor_id, count(*)::int AS active_plan_count
      FROM game.action_plans
      WHERE exclusive_physical
        AND status IN (
          'planned', 'running', 'waiting_for_time', 'waiting_for_world_event',
          'waiting_for_clarification', 'blocked'
        )
      GROUP BY world_id, shard_id, actor_id
      HAVING count(*) > 1
    `,
  );

  await requireZero(
    "completed requests have player-safe results",
    database.client`
      SELECT request_id
      FROM game.world_action_requests
      WHERE status = 'completed' AND player_safe_result IS NULL
      LIMIT 20
    `,
  );

  await requireZero(
    "completed plans have only terminal steps",
    database.client`
      SELECT plan.plan_id
      FROM game.action_plans plan
      JOIN game.action_plan_steps step ON step.plan_id = plan.plan_id
      WHERE plan.status = 'completed'
      GROUP BY plan.plan_id
      HAVING bool_or(step.status NOT IN ('completed', 'failed', 'cancelled', 'superseded'))
    `,
  );

  await requireZero(
    "resolved schedules have result events",
    database.client`
      SELECT schedule_id
      FROM game.scheduled_actions
      WHERE status = 'resolved' AND result_event_id IS NULL
      LIMIT 20
    `,
  );

  await requireZero(
    "resolving schedules have valid leases",
    database.client`
      SELECT schedule_id
      FROM game.scheduled_actions
      WHERE status = 'resolving'
        AND (worker_id IS NULL OR lease_expires_at IS NULL)
      LIMIT 20
    `,
  );

  await requireZero(
    "immutable-row protection triggers remain enabled",
    database.client`
      SELECT namespace.nspname AS schema_name,
             relation.relname AS table_name,
             trigger.tgname AS trigger_name,
             trigger.tgenabled
      FROM pg_trigger trigger
      JOIN pg_class relation ON relation.oid = trigger.tgrelid
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      JOIN pg_proc function ON function.oid = trigger.tgfoid
      WHERE function.proname = 'reject_immutable_row_change'
        AND NOT trigger.tgisinternal
        AND trigger.tgenabled <> 'O'
    `,
  );

  console.log("All Nocturne database invariants passed.");
} finally {
  await database.close();
}
