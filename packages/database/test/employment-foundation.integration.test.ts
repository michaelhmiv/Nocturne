import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDatabase,
  createEmploymentStore,
  type WorldScope,
} from "../src/index.js";

const execFileAsync = promisify(execFile);
const databaseUrl = process.env.DATABASE_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("authoritative employment foundation", () => {
  const db = createDatabase(databaseUrl!);
  const employment = createEmploymentStore(db);
  const run = randomUUID();
  const foreignRun = randomUUID();
  const world = randomUUID();
  const foreignWorld = randomUUID();
  const shard = randomUUID();
  const foreignShard = randomUUID();
  const user = "employment:" + run;
  const competingUser = "employment:competing:" + run;
  const foreignUser = "employment:foreign:" + run;
  const employer = randomUUID();
  let actor = "";
  let competitor = "";
  let foreignActor = "";
  let offer = "";
  let position = "";
  const scope: WorldScope = {
    worldId: world, shardId: shard, userId: user,
    role: "player", selectedCharacterId: null,
  };
  const competingScope: WorldScope = {
    ...scope, userId: competingUser,
  };
  const operator: WorldScope = { ...scope, role: "operator" };

  beforeAll(async () => {
    await execFileAsync("pnpm", ["exec", "tsx", "src/migrate.ts"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    for (const [runId, worldId, shardId] of [
      [run, world, shard],
      [foreignRun, foreignWorld, foreignShard],
    ]) {
      await db.client.unsafe(
        "INSERT INTO game.worlds(world_id,slug,name,metadata) VALUES($1,$2,'Employment test',$3::jsonb)",
        [worldId, "employment-" + runId, JSON.stringify({ isolatedCertification: true })],
      );
      await db.client.unsafe(
        "INSERT INTO game.world_shards(shard_id,world_id,slug,name) VALUES($1,$2,'primary','Primary')",
        [shardId, worldId],
      );
      await db.client.unsafe(
        "INSERT INTO game.certification_runs(run_id,world_id,shard_id,expires_at) VALUES($1,$2,$3,now()+interval '30 minutes')",
        [runId, worldId, shardId],
      );
    }
    for (const [userId, runId, worldId, shardId] of [
      [user, run, world, shard],
      [competingUser, run, world, shard],
      [foreignUser, foreignRun, foreignWorld, foreignShard],
    ]) {
      await db.client.unsafe(
        "INSERT INTO game.certification_players(run_id,user_id,world_id,shard_id) VALUES($1,$2,$3,$4)",
        [runId, userId, worldId, shardId],
      );
      await db.client.unsafe(
        "INSERT INTO game.world_memberships(world_id,user_id,role,status) VALUES($1,$2,'player','active')",
        [worldId, userId],
      );
    }
    const nameByUser = new Map([
      [user, "Mara Velez"],
      [competingUser, "Dax Mercer"],
      [foreignUser, "Imani Brooks"],
    ]);
    const players: string[] = [];
    for (const [runId, userId] of [
      [run, user],
      [run, competingUser],
      [foreignRun, foreignUser],
    ]) {
      const rows = await db.client.unsafe(
        "SELECT * FROM game.provision_certification_player($1,$2,$3)",
        [runId, userId, nameByUser.get(userId)],
      );
      players.push(String(rows[0].actor_id));
    }
    [actor, competitor, foreignActor] = players;
    await db.client.unsafe(
      "INSERT INTO game.entity_definitions(definition_id,definition_type,name,concept_summary,origin_source,lifecycle_status,world_id) VALUES($1,'business','Orchard Market','A real test employer','isolated_certification','approved',$2)",
      ["EMPLOYMENT-" + run, world],
    );
    await db.client.unsafe(
      "INSERT INTO game.entity_instances(instance_id,definition_id,world_id,shard_id,state) VALUES($1,$2,$3,$4,$5::jsonb)",
      [employer, "EMPLOYMENT-" + run, world, shard, JSON.stringify({ cashOnPerson: 5000 })],
    );
    await db.client.unsafe(
      "UPDATE game.entity_instances SET state=jsonb_set(state,'{cashOnPerson}','100'::jsonb,true) WHERE instance_id=$1",
      [actor],
    );
    const created = await employment.postOffer({
      scope: operator, employerId: employer, title: "Market closing shift",
      wageCents: 700, durationSeconds: 1, capacity: 1,
    });
    offer = created.offerId;
  });

  afterAll(() => db.close());

  it("offers are scoped; player cannot provision or accept fictitious jobs", async () => {
    const visible = await employment.listOffers(scope);
    expect(visible.map((row) => row.offer_id)).toContain(offer);
    expect(await employment.listOffers({ ...scope, worldId: foreignWorld, shardId: foreignShard }))
      .toHaveLength(0);
    await expect(employment.postOffer({
      scope, employerId: employer, title: "Unapproved job", wageCents: 1,
      durationSeconds: 1, capacity: 1,
    })).rejects.toMatchObject({ code: "forbidden" });
    await expect(employment.acceptOffer({
      scope, actorId: actor, offerId: randomUUID(),
    })).rejects.toMatchObject({ code: "not_found" });
    await expect(employment.postOffer({
      scope: { ...operator, worldId: foreignWorld, shardId: foreignShard },
      employerId: employer, title: "Cross world job", wageCents: 100,
      durationSeconds: 1, capacity: 1,
    })).rejects.toMatchObject({ code: "23514" });
    await expect(employment.acceptOffer({
      scope, actorId: foreignActor, offerId: offer,
    })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("locks offer capacity under competing applicants and preserves replay identity", async () => {
    const results = await Promise.allSettled([
      employment.acceptOffer({ scope, actorId: actor, offerId: offer }),
      employment.acceptOffer({
        scope: competingScope, actorId: competitor, offerId: offer,
      }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const winner = results.find((result) => result.status === "fulfilled");
    const loser = results.find((result) => result.status === "rejected");
    expect(loser?.status === "rejected" ? loser.reason.code : null).toBe("capacity_full");
    expect(winner?.status).toBe("fulfilled");
    const hired = await db.client.unsafe(
      "SELECT position_id,worker_id FROM game.employment_positions WHERE offer_id=$1",
      [offer],
    );
    expect(hired).toHaveLength(1);
    // Subsequent shift tests use the true owner, not a fabricated winner.
    position = String(hired[0].position_id);
    const hiredScope = hired[0].worker_id === actor ? scope : competingScope;
    const hiredActor = String(hired[0].worker_id);
    const replay = await employment.acceptOffer({
      scope: hiredScope, actorId: hiredActor, offerId: offer,
    });
    expect(replay).toEqual({ positionId: position, replay: true });
  });

  it("uses real elapsed time and commits one balanced wage even on simultaneous replay", async () => {
    const hired = await db.client.unsafe(
      "SELECT worker_id FROM game.employment_positions WHERE position_id=$1",
      [position],
    );
    const workingActor = String(hired[0].worker_id);
    const workingScope = workingActor === actor ? scope : competingScope;
    await expect(employment.startShift({
      scope: workingActor === actor ? competingScope : scope,
      actorId: workingActor, positionId: position,
    })).rejects.toMatchObject({ code: "forbidden" });
    const started = await employment.startShift({
      scope: workingScope, actorId: workingActor, positionId: position,
    });
    const startedAgain = await employment.startShift({
      scope: workingScope, actorId: workingActor, positionId: position,
    });
    expect(startedAgain).toMatchObject({ shiftId: started.shiftId, replay: true });
    await expect(employment.settleShift({
      scope: workingScope, actorId: workingActor, shiftId: started.shiftId,
    })).rejects.toMatchObject({ code: "too_early" });
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const [first, second] = await Promise.all([
      employment.settleShift({
        scope: workingScope, actorId: workingActor, shiftId: started.shiftId,
      }),
      employment.settleShift({
        scope: workingScope, actorId: workingActor, shiftId: started.shiftId,
      }),
    ]);
    expect(first.eventId).toBe(second.eventId);
    expect([first.replay, second.replay].sort()).toEqual([false, true]);
    expect(first.wageCents).toBe(700);
    const payments = await db.client.unsafe(
      "SELECT payment_id,world_id,shard_id,event_id FROM game.employment_payments WHERE shift_id=$1",
      [started.shiftId],
    );
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      world_id: world, shard_id: shard, event_id: first.eventId,
    });
    const event = await db.client.unsafe(
      "SELECT world_id,shard_id,event_type,payload FROM game.event_ledger WHERE event_id=$1",
      [first.eventId],
    );
    expect(event[0]).toMatchObject({
      world_id: world, shard_id: shard, event_type: "employment_wage_paid",
    });
    expect(event[0].payload.wageCents).toBe(700);
    const balances = await db.client.unsafe(
      "SELECT instance_id,(state->>'cashOnPerson')::integer AS cash FROM game.entity_instances WHERE instance_id=ANY($1::uuid[])",
      [[workingActor, employer]],
    );
    expect(Number(balances.find((row) => row.instance_id === employer)?.cash)).toBe(4300);
    expect(Number(balances.find((row) => row.instance_id === workingActor)?.cash)).toBe(
      workingActor === actor ? 800 : 700,
    );
  });

  it("does not pay a shift a second time or permit a foreign user to settle", async () => {
    const rows = await db.client.unsafe(
      "SELECT s.shift_id,p.worker_id FROM game.employment_shifts s JOIN game.employment_positions p ON p.position_id=s.position_id WHERE p.position_id=$1",
      [position],
    );
    const workingActor = String(rows[0].worker_id);
    await expect(employment.settleShift({
      scope: { ...scope, userId: foreignUser }, actorId: workingActor,
      shiftId: String(rows[0].shift_id),
    })).rejects.toMatchObject({ code: "forbidden" });
    await expect(employment.settleShift({
      scope: { ...scope, worldId: foreignWorld, shardId: foreignShard },
      actorId: workingActor, shiftId: String(rows[0].shift_id),
    })).rejects.toMatchObject({ code: "forbidden" });
  });
});
