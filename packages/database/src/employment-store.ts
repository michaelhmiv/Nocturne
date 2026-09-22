import { randomUUID } from "node:crypto";
import type { createDatabase } from "./index.js";
import type { WorldScope } from "./world-store.js";

export class EmploymentStoreError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "forbidden"
      | "invalid_state"
      | "capacity_full"
      | "too_early"
      | "insufficient_funds",
    message: string,
  ) {
    super(message);
    this.name = "EmploymentStoreError";
  }
}

type Scope = Pick<WorldScope, "worldId" | "shardId" | "userId" | "role">;
type ShiftRow = {
  shift_id: string;
  status: string;
  finishes_at: Date;
  position_id: string;
  worker_id: string;
  employer_id: string;
  wage_cents: number;
};

function validMoney(value: unknown): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new EmploymentStoreError("invalid_state", "Invalid cash balance.");
  }
  return number;
}

export function createEmploymentStore(database: ReturnType<typeof createDatabase>) {
  async function listOffers(scope: Scope) {
    return database.client.unsafe(
      "SELECT offer_id, employer_id, title, wage_cents, duration_seconds, capacity FROM game.employment_offers WHERE world_id=$1 AND shard_id=$2 AND status='open' ORDER BY created_at DESC LIMIT 100",
      [scope.worldId, scope.shardId],
    );
  }

  // Trusted provisioning only. Never expose this operation to normal player/MCP principals.
  async function postOffer(input: {
    scope: Scope;
    employerId: string;
    title: string;
    wageCents: number;
    durationSeconds: number;
    capacity: number;
  }) {
    if (!["operator", "owner"].includes(input.scope.role)) {
      throw new EmploymentStoreError("forbidden", "Trusted offer provisioning required.");
    }
    if (
      !Number.isSafeInteger(input.wageCents) ||
      input.wageCents <= 0 ||
      !Number.isInteger(input.durationSeconds) ||
      input.durationSeconds < 1 ||
      input.durationSeconds > 86400 ||
      !Number.isInteger(input.capacity) ||
      input.capacity < 1 ||
      input.capacity > 1000
    ) {
      throw new EmploymentStoreError("invalid_state", "Invalid job offer terms.");
    }
    const id = randomUUID();
    await database.client.unsafe(
      "INSERT INTO game.employment_offers(offer_id,world_id,shard_id,employer_id,title,wage_cents,duration_seconds,capacity) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        id,
        input.scope.worldId,
        input.scope.shardId,
        input.employerId,
        input.title,
        input.wageCents,
        input.durationSeconds,
        input.capacity,
      ],
    );
    return { offerId: id };
  }

  async function acceptOffer(input: { scope: Scope; actorId: string; offerId: string }) {
    return database.client.begin(async (sql) => {
      const owned = await sql.unsafe(
        "SELECT 1 FROM game.player_characters WHERE world_id=$1 AND user_id=$2 AND character_instance_id=$3",
        [input.scope.worldId, input.scope.userId, input.actorId],
      );
      if (!owned[0]) throw new EmploymentStoreError("forbidden", "Not your character.");
      // Lock the offer to serialize competing applicants and enforce capacity.
      const offers = await sql.unsafe(
        "SELECT offer_id,capacity,status FROM game.employment_offers WHERE offer_id=$1 AND world_id=$2 AND shard_id=$3 FOR UPDATE",
        [input.offerId, input.scope.worldId, input.scope.shardId],
      );
      const offer = offers[0];
      if (!offer || offer.status !== "open") {
        throw new EmploymentStoreError("not_found", "No available offer.");
      }
      const prior = await sql.unsafe(
        "SELECT position_id,status FROM game.employment_positions WHERE offer_id=$1 AND worker_id=$2",
        [input.offerId, input.actorId],
      );
      if (prior[0]) {
        if (prior[0].status !== "active") {
          throw new EmploymentStoreError("invalid_state", "Position has ended.");
        }
        return { positionId: String(prior[0].position_id), replay: true };
      }
      const count = await sql.unsafe(
        "SELECT count(*)::integer AS total FROM game.employment_positions WHERE offer_id=$1 AND status='active'",
        [input.offerId],
      );
      if (Number(count[0].total) >= Number(offer.capacity)) {
        throw new EmploymentStoreError("capacity_full", "No positions remain.");
      }
      const positionId = randomUUID();
      await sql.unsafe(
        "INSERT INTO game.employment_positions(position_id,world_id,shard_id,offer_id,worker_id) VALUES($1,$2,$3,$4,$5)",
        [positionId, input.scope.worldId, input.scope.shardId, input.offerId, input.actorId],
      );
      return { positionId, replay: false };
    });
  }

  async function startShift(input: { scope: Scope; actorId: string; positionId: string }) {
    return database.client.begin(async (sql) => {
      const positions = await sql.unsafe(
        "SELECT p.position_id,p.worker_id,p.status,o.duration_seconds,o.status AS offer_status FROM game.employment_positions p JOIN game.employment_offers o ON o.offer_id=p.offer_id JOIN game.player_characters pc ON pc.character_instance_id=p.worker_id AND pc.world_id=p.world_id WHERE p.position_id=$1 AND p.world_id=$2 AND p.shard_id=$3 AND p.worker_id=$4 AND pc.user_id=$5 FOR UPDATE OF p",
        [
          input.positionId,
          input.scope.worldId,
          input.scope.shardId,
          input.actorId,
          input.scope.userId,
        ],
      );
      const position = positions[0];
      if (!position) throw new EmploymentStoreError("forbidden", "Position not held by actor.");
      if (position.status !== "active" || position.offer_status !== "open") {
        throw new EmploymentStoreError("invalid_state", "Position is not available for work.");
      }
      const current = await sql.unsafe(
        "SELECT shift_id FROM game.employment_shifts WHERE position_id=$1 AND status='working'",
        [input.positionId],
      );
      if (current[0]) {
        return { shiftId: String(current[0].shift_id), replay: true };
      }
      const shiftId = randomUUID();
      const rows = await sql.unsafe(
        "INSERT INTO game.employment_shifts(shift_id,world_id,shard_id,position_id,finishes_at) VALUES($1,$2,$3,$4,now()+($5::integer * interval '1 second')) RETURNING finishes_at",
        [
          shiftId,
          input.scope.worldId,
          input.scope.shardId,
          input.positionId,
          position.duration_seconds,
        ],
      );
      return { shiftId, finishesAt: new Date(rows[0].finishes_at).toISOString(), replay: false };
    });
  }

  async function settleShift(input: { scope: Scope; actorId: string; shiftId: string }) {
    return database.client.begin(async (sql) => {
      const rows = await sql.unsafe(
        "SELECT s.shift_id,s.status,s.finishes_at,s.position_id,p.worker_id,o.employer_id,o.wage_cents FROM game.employment_shifts s JOIN game.employment_positions p ON p.position_id=s.position_id JOIN game.employment_offers o ON o.offer_id=p.offer_id JOIN game.player_characters pc ON pc.character_instance_id=p.worker_id AND pc.world_id=p.world_id WHERE s.shift_id=$1 AND s.world_id=$2 AND s.shard_id=$3 AND p.worker_id=$4 AND pc.user_id=$5 FOR UPDATE OF s",
        [
          input.shiftId,
          input.scope.worldId,
          input.scope.shardId,
          input.actorId,
          input.scope.userId,
        ],
      );
      const shift = rows[0] as ShiftRow | undefined;
      if (!shift) throw new EmploymentStoreError("forbidden", "No eligible shift.");
      const prior = await sql.unsafe(
        "SELECT event_id,amount_cents FROM game.employment_payments WHERE shift_id=$1 AND world_id=$2 AND shard_id=$3",
        [shift.shift_id, input.scope.worldId, input.scope.shardId],
      );
      if (prior[0]) {
        return {
          shiftId: shift.shift_id,
          eventId: String(prior[0].event_id),
          wageCents: Number(prior[0].amount_cents),
          replay: true,
        };
      }
      if (shift.status !== "working") {
        throw new EmploymentStoreError("invalid_state", "Shift is not working.");
      }
      // Clock is authoritative DB time, not a client- or model-supplied elapsed duration.
      const due = await sql.unsafe("SELECT now() >= $1::timestamptz AS due", [shift.finishes_at]);
      if (!due[0].due) throw new EmploymentStoreError("too_early", "Shift is still in progress.");
      // One transactional lock order for concurrent payroll settlements.
      const accounts = await sql.unsafe(
        "SELECT instance_id,state FROM game.entity_instances WHERE instance_id=ANY($1::uuid[]) AND world_id=$2 AND shard_id=$3 ORDER BY instance_id FOR UPDATE",
        [[shift.employer_id, shift.worker_id], input.scope.worldId, input.scope.shardId],
      );
      if (accounts.length !== 2 || shift.employer_id === shift.worker_id) {
        throw new EmploymentStoreError("invalid_state", "Employer or worker is unavailable.");
      }
      const employer = accounts.find((row) => row.instance_id === shift.employer_id);
      const worker = accounts.find((row) => row.instance_id === shift.worker_id);
      if (!employer || !worker) {
        throw new EmploymentStoreError("invalid_state", "Employment account missing.");
      }
      const wageCents = Number(shift.wage_cents);
      const employerCash = validMoney(
        (employer.state as Record<string, unknown>).cashOnPerson ?? 0,
      );
      const workerCash = validMoney((worker.state as Record<string, unknown>).cashOnPerson ?? 0);
      if (employerCash < wageCents) {
        throw new EmploymentStoreError("insufficient_funds", "Employer cannot fund the wage.");
      }
      if (!Number.isSafeInteger(workerCash + wageCents)) {
        throw new EmploymentStoreError("invalid_state", "Wage would overflow cash balance.");
      }
      await sql.unsafe(
        "UPDATE game.entity_instances SET state=jsonb_set(state,'{cashOnPerson}',to_jsonb($1::bigint),true),updated_at=now() WHERE instance_id=$2 AND world_id=$3 AND shard_id=$4",
        [employerCash - wageCents, shift.employer_id, input.scope.worldId, input.scope.shardId],
      );
      await sql.unsafe(
        "UPDATE game.entity_instances SET state=jsonb_set(state,'{cashOnPerson}',to_jsonb($1::bigint),true),updated_at=now() WHERE instance_id=$2 AND world_id=$3 AND shard_id=$4",
        [workerCash + wageCents, shift.worker_id, input.scope.worldId, input.scope.shardId],
      );
      const eventId = randomUUID();
      const payload = JSON.stringify({
        shiftId: shift.shift_id,
        workerId: shift.worker_id,
        employerId: shift.employer_id,
        wageCents,
        operationTypes: ["employment_wage_transfer"],
        playerVisibleFacts: ["Your shift is complete and the agreed wage has been paid."],
      });
      await sql.unsafe(
        "INSERT INTO game.event_ledger(event_id,world_id,shard_id,idempotency_key,world_time,event_type,involved_entity_ids,payload) VALUES($1,$2,$3,$4,now(),'employment_wage_paid',$5::jsonb,$6::jsonb)",
        [
          eventId,
          input.scope.worldId,
          input.scope.shardId,
          "employment:pay:" + shift.shift_id,
          JSON.stringify([shift.worker_id, shift.employer_id]),
          payload,
        ],
      );
      await sql.unsafe(
        "INSERT INTO game.employment_payments(world_id,shard_id,shift_id,worker_id,employer_id,amount_cents,event_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          input.scope.worldId,
          input.scope.shardId,
          shift.shift_id,
          shift.worker_id,
          shift.employer_id,
          wageCents,
          eventId,
        ],
      );
      await sql.unsafe(
        "UPDATE game.employment_shifts SET status='completed',completed_at=now() WHERE shift_id=$1",
        [shift.shift_id],
      );
      return { shiftId: shift.shift_id, eventId, wageCents, replay: false };
    });
  }

  return { listOffers, postOffer, acceptOffer, startShift, settleShift };
}

export type EmploymentStore = ReturnType<typeof createEmploymentStore>;
