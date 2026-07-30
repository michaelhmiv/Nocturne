import { createDatabase } from "@nocturne/database";

const json = (value: unknown) => JSON.stringify(value);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error(JSON.stringify({ level: "error", service: "worker", message: "worker_start_failed", error: "DATABASE_URL is required." }));
  process.exit(1);
}

const POLL_INTERVAL_MS = 5_000;
const database = createDatabase(databaseUrl);
try {
  await database.client`SELECT 1`;
} catch {
  console.error(JSON.stringify({ level: "error", service: "worker", message: "worker_start_failed", error: "Database connection failed." }));
  await database.close();
  process.exit(1);
}

console.log(JSON.stringify({ level: "info", service: "worker", message: "worker_started" }));

let shuttingDown = false;

async function resolveJob(row: {
  schedule_id: string;
  intent_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
}) {
  const kind = row.kind || "action";
  const payload = row.payload || {};

  if (kind === "move") {
    const actorId = String(payload.actorId || "");
    const locationId = String(payload.locationId || "");
    if (actorId && locationId) {
      await database.client`
        UPDATE game.entity_instances
        SET location_id = ${locationId}, updated_at = now()
        WHERE instance_id = ${actorId}
      `;
    }
    return;
  }

  if (kind === "jail_release") {
    const actorId = String(payload.actorId || "");
    if (actorId) {
      const rows = await database.client`
        SELECT state FROM game.entity_instances WHERE instance_id = ${actorId}
      `;
      const state = { ...((rows[0]?.state as Record<string, unknown>) || {}) };
      state.status = "active";
      state.heat = Math.max(0, Number(state.heat || 0) - 20);
      await database.client`
        UPDATE game.entity_instances SET state = ${json(state)}, updated_at = now()
        WHERE instance_id = ${actorId}
      `;
    }
    return;
  }

  if (kind === "craft_complete") {
    // ponytail: mark request installed payload complete; full install already ran if immediate.
    const requestId = payload.requestId ? String(payload.requestId) : null;
    if (requestId) {
      await database.client`
        UPDATE game.generated_content_requests
        SET validation_status = CASE
          WHEN validation_status = 'crafting' THEN 'ready'
          ELSE validation_status
        END,
        updated_at = now()
        WHERE request_id = ${requestId}
      `;
    }
    return;
  }

  // default: action schedule — already committed at create time
}

async function tick() {
  if (shuttingDown) return;
  try {
    const due = await database.client`
      UPDATE game.scheduled_actions
      SET status = 'resolving'
      WHERE schedule_id IN (
        SELECT schedule_id FROM game.scheduled_actions
        WHERE status = 'pending' AND resolves_at <= now()
        ORDER BY resolves_at
        LIMIT 10
        FOR UPDATE SKIP LOCKED
      )
      RETURNING schedule_id, intent_id, kind, payload
    `;

    for (const row of due) {
      try {
        await resolveJob({
          schedule_id: String(row.schedule_id),
          intent_id: row.intent_id ? String(row.intent_id) : null,
          kind: String(row.kind || "action"),
          payload: (row.payload as Record<string, unknown>) || {},
        });
        await database.client`
          UPDATE game.scheduled_actions SET status = 'resolved'
          WHERE schedule_id = ${row.schedule_id}
        `;
        console.log(
          JSON.stringify({
            level: "debug",
            service: "worker",
            schedule_id: row.schedule_id,
            kind: row.kind,
            message: "job_resolved",
          }),
        );
      } catch (error) {
        await database.client`
          UPDATE game.scheduled_actions SET status = 'failed'
          WHERE schedule_id = ${row.schedule_id}
        `;
        console.error(
          JSON.stringify({ level: "error", service: "worker", schedule_id: row.schedule_id, error: String(error) }),
        );
      }
    }
  } catch (error) {
    console.error(JSON.stringify({ level: "error", service: "worker", message: "tick_failed", error: String(error) }));
  }
}

const poller = setInterval(tick, POLL_INTERVAL_MS);
tick();

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(poller);
  await database.close();
  console.log(JSON.stringify({ level: "info", service: "worker", message: "worker_stopping", signal }));
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
