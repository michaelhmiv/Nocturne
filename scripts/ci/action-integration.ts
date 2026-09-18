import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createDatabase } from "../../packages/database/src/index.js";
import { createUniversalOperationExecutor } from "../../packages/database/src/universal-operation-executor.js";
import {
  ACTION_CAPABILITIES,
  ACTION_CAPABILITY_NAMES,
} from "../../test/capabilities/action-capabilities.js";

const apiUrl = (process.env.NOCTURNE_API_URL || "http://127.0.0.1:3101").replace(/\/$/, "");
const databaseUrl = process.env.DATABASE_URL;
const resultPath =
  process.env.ACTION_INTEGRATION_RESULTS || "artifacts/action-integration-results.json";
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const database = createDatabase(databaseUrl);
const guestHeaders = {
  "content-type": "application/json",
  "x-nocturne-guest-mode": "1",
};

async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { ...guestHeaders, ...(init.headers || {}) },
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { response, payload: payload as Record<string, any>, text };
}

async function requireOk(path: string, init?: RequestInit) {
  const result = await request(path, init);
  if (!result.response.ok) {
    throw new Error(
      `${init?.method || "GET"} ${path} returned ${result.response.status}: ${result.text.slice(0, 2000)}`,
    );
  }
  return result.payload;
}

async function waitForApi() {
  const deadline = Date.now() + 120_000;
  let last = "not started";
  while (Date.now() < deadline) {
    try {
      const result = await request("/health");
      last = `${result.response.status} ${result.text}`;
      if (result.response.ok && result.payload.status === "ok") return;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`API did not become healthy: ${last}`);
}

async function setupCharacter() {
  await requireOk("/v1/world/start");
  const created = await requireOk("/v1/characters", {
    method: "POST",
    headers: { "idempotency-key": `ci-character-${randomUUID()}` },
    body: JSON.stringify({
      name: "Certification Agent",
      conceptSummary: "A deterministic test character used only for exhaustive CI certification.",
      originSource: "ci",
      qualities: {
        investigation: 8,
        combat: 8,
        stealth: 8,
        persuasion: 8,
        mechanics: 8,
        hacking: 8,
        medicine: 8,
        engineering: 8,
        electronics: 8,
        driving: 8,
        athletics: 8,
      },
    }),
  });
  const actorId = String(created.characterId);
  await requireOk(`/v1/characters/${actorId}/select`, { method: "POST", body: "{}" });
  await requireOk("/v1/residences/starter/rent", {
    method: "POST",
    headers: { "idempotency-key": `ci-residence-${randomUUID()}` },
    body: JSON.stringify({ characterId: actorId }),
  });
  return actorId;
}

async function setupTransferFixtures(actorId: string) {
  const actorRows = await database.client<
    { world_id: string; shard_id: string; location_id: string | null }[]
  >`
    SELECT world_id, shard_id, location_id
    FROM game.entity_instances
    WHERE instance_id = ${actorId}
  `;
  const actor = actorRows[0];
  if (!actor?.location_id) throw new Error("Certification actor has no physical location.");

  const executor = createUniversalOperationExecutor(database);
  const seeded = await executor.execute({
    scope: {
      worldId: actor.world_id,
      shardId: actor.shard_id,
      userId: "ci-certification-operator",
      role: "owner",
    },
    authority: "operator",
    idempotencyKey: `certification:transfer-fixtures:${actorId}`,
    declaredFactIds: [],
    branch: {
      operations: [
        {
          type: "create_definition",
          symbol: "transfer_item_definition",
          definitionType: "item",
          name: "Certification Wrench",
          conceptSummary: "A plain steel wrench used for deterministic transfer certification.",
          originSource: "ci",
          lifecycleStatus: "approved",
          preconditionFactIds: [],
        },
        {
          type: "create_instance",
          symbol: "transfer_item",
          definitionRef: { kind: "symbol", symbol: "transfer_item_definition" },
          locationRef: { kind: "existing", entityId: actor.location_id },
          condition: 100,
          state: { certificationFixture: true },
          provenance: {
            sourceType: "administrative_repair",
            sourceId: "action-integration",
            policyVersion: "ci-transfer-v1",
            payload: { purpose: "neutral transfer certification" },
          },
          preconditionFactIds: [],
        },
        {
          type: "create_definition",
          symbol: "transfer_recipient_definition",
          definitionType: "character",
          name: "Certification Mechanic",
          conceptSummary: "A stationary CI recipient used only for deterministic transfer certification.",
          originSource: "ci",
          lifecycleStatus: "approved",
          preconditionFactIds: [],
        },
        {
          type: "create_instance",
          symbol: "transfer_recipient",
          definitionRef: { kind: "symbol", symbol: "transfer_recipient_definition" },
          locationRef: { kind: "existing", entityId: actor.location_id },
          condition: 100,
          state: { certificationFixture: true },
          provenance: {
            sourceType: "administrative_repair",
            sourceId: "action-integration",
            policyVersion: "ci-transfer-v1",
            payload: { purpose: "neutral transfer certification" },
          },
          preconditionFactIds: [],
        },
        {
          type: "set_relation",
          sourceRef: { kind: "existing", entityId: actorId },
          targetRef: { kind: "symbol", symbol: "transfer_item" },
          relationType: "observed",
          parameters: { visibility: "player_known" },
          preconditionFactIds: [],
        },
        {
          type: "set_relation",
          sourceRef: { kind: "existing", entityId: actorId },
          targetRef: { kind: "symbol", symbol: "transfer_recipient" },
          relationType: "observed",
          parameters: { visibility: "player_known" },
          preconditionFactIds: [],
        },
      ],
    },
    playerVisibleFacts: [],
    hiddenFacts: [],
  });

  const itemId = seeded.symbolMap.transfer_item;
  const recipientId = seeded.symbolMap.transfer_recipient;
  if (!itemId || !recipientId) throw new Error("Transfer certification fixture symbols were not resolved.");
  return { itemId, recipientId };
}

async function possession(itemId: string) {
  const rows = await database.client<{ possessor_id: string }[]>`
    SELECT target_instance_id AS possessor_id
    FROM game.entity_relations
    WHERE source_instance_id = ${itemId}
      AND relation_type = 'possessed_by'
  `;
  return rows.map((row) => row.possessor_id);
}

async function runTransferCommand(actorId: string, command: string, idempotencyKey: string) {
  const response = await request("/v1/persistent-world/actions", {
    method: "POST",
    headers: { "idempotency-key": idempotencyKey },
    body: JSON.stringify({ actorId, command }),
  });
  if (!response.response.ok || response.payload.state !== "completed") {
    throw new Error(`Transfer command failed: ${command}: ${response.text}`);
  }
  return response.payload;
}

async function certifyNeutralTransfers(actorId: string) {
  const { itemId, recipientId } = await setupTransferFixtures(actorId);

  const pickupKey = `certification:pickup:${randomUUID()}`;
  const pickup = await runTransferCommand(
    actorId,
    "Pick up the Certification Wrench.",
    pickupKey,
  );
  if (JSON.stringify(await possession(itemId)) !== JSON.stringify([actorId])) {
    throw new Error("Pickup did not make the actor the sole possessor.");
  }

  const replay = await runTransferCommand(
    actorId,
    "Pick up the Certification Wrench.",
    pickupKey,
  );
  if (replay.requestId !== pickup.requestId) {
    throw new Error("Pickup idempotent replay returned a different request.");
  }
  if (JSON.stringify(await possession(itemId)) !== JSON.stringify([actorId])) {
    throw new Error("Pickup replay duplicated or changed possession.");
  }

  await runTransferCommand(
    actorId,
    "Drop the Certification Wrench.",
    `certification:drop:${randomUUID()}`,
  );
  if ((await possession(itemId)).length !== 0) {
    throw new Error("Drop did not relinquish possession.");
  }

  await runTransferCommand(
    actorId,
    "Pick up the Certification Wrench.",
    `certification:pickup-again:${randomUUID()}`,
  );
  await runTransferCommand(
    actorId,
    "Give the Certification Wrench to the Certification Mechanic.",
    `certification:give:${randomUUID()}`,
  );
  if (JSON.stringify(await possession(itemId)) !== JSON.stringify([recipientId])) {
    throw new Error("Give did not transfer possession to the resolved recipient.");
  }

  const ownerRows = await database.client<{ owner_id: string | null }[]>`
    SELECT owner_id FROM game.entity_instances WHERE instance_id = ${itemId}
  `;
  if (ownerRows[0]?.owner_id !== null) {
    throw new Error("Possession transfer unexpectedly changed authoritative ownership.");
  }

  return {
    itemId,
    recipientId,
    pickupRequestId: pickup.requestId,
    givePossessorId: recipientId,
    ownerId: ownerRows[0]?.owner_id ?? null,
  };
}

async function databaseSnapshot(requestId: string) {
  const requests = await database.client<
    {
      request_id: string;
      status: string;
      plan_id: string | null;
      error_code: string | null;
      player_safe_result: Record<string, unknown> | null;
    }[]
  >`
    SELECT request_id, status, plan_id, error_code, player_safe_result
    FROM game.world_action_requests
    WHERE request_id = ${requestId}
  `;
  const requestRow = requests[0];
  if (!requestRow) throw new Error(`Request ${requestId} was not persisted.`);
  const steps = requestRow.plan_id
    ? await database.client<
        {
          step_id: string;
          step_kind: string;
          status: string;
          intent_payload: Record<string, unknown>;
          result_event_id: string | null;
          result_receipt_id: string | null;
        }[]
      >`
        SELECT step_id, step_kind, status, intent_payload,
               result_event_id, result_receipt_id
        FROM game.action_plan_steps
        WHERE plan_id = ${requestRow.plan_id}
        ORDER BY step_order
      `
    : [];
  const schedules = requestRow.plan_id
    ? await database.client<
        {
          schedule_id: string;
          status: string;
          plan_id: string | null;
          step_id: string | null;
          result_event_id: string | null;
        }[]
      >`
        SELECT schedule_id, status, plan_id, step_id, result_event_id
        FROM game.scheduled_actions
        WHERE plan_id = ${requestRow.plan_id}
        ORDER BY created_at
      `
    : [];
  return { request: requestRow, steps, schedules };
}

async function counts(requestId: string) {
  const rows = await database.client<
    { plans: number; steps: number; schedules: number; stages: number }[]
  >`
    SELECT
      (SELECT count(*)::int FROM game.action_plans p
       JOIN game.world_action_requests r ON r.plan_id = p.plan_id
       WHERE r.request_id = ${requestId}) AS plans,
      (SELECT count(*)::int FROM game.action_plan_steps s
       JOIN game.world_action_requests r ON r.plan_id = s.plan_id
       WHERE r.request_id = ${requestId}) AS steps,
      (SELECT count(*)::int FROM game.scheduled_actions a
       JOIN game.world_action_requests r ON r.plan_id = a.plan_id
       WHERE r.request_id = ${requestId}) AS schedules,
      (SELECT count(*)::int FROM game.world_action_execution_stages
       WHERE request_id = ${requestId}) AS stages
  `;
  return rows[0]!;
}

async function runAction(actorId: string, actionType: keyof typeof ACTION_CAPABILITIES) {
  const capability = ACTION_CAPABILITIES[actionType];
  const command = capability.canonicalPrompts[0];
  const idempotencyKey = `certification:${actionType}:${randomUUID()}`;
  const traceId = `certification-${actionType}-${randomUUID()}`;
  const first = await request("/v1/persistent-world/actions", {
    method: "POST",
    headers: {
      "idempotency-key": idempotencyKey,
      "x-nocturne-trace-id": traceId,
    },
    body: JSON.stringify({ actorId, command }),
  });
  if (!first.response.ok) {
    throw new Error(
      `${actionType} failed with ${first.response.status}: ${first.text.slice(0, 3000)}`,
    );
  }
  if (!["completed", "waiting"].includes(String(first.payload.state))) {
    throw new Error(`${actionType} produced non-executable state: ${first.text}`);
  }
  const requestId = String(first.payload.requestId || "");
  if (!requestId) throw new Error(`${actionType} did not return requestId.`);
  const snapshot = await databaseSnapshot(requestId);
  const firstStep = snapshot.steps[0];
  if (!firstStep) throw new Error(`${actionType} created no persistent plan step.`);
  if (firstStep.step_kind !== capability.worldKind) {
    throw new Error(
      `${actionType} routed to ${firstStep.step_kind}; expected ${capability.worldKind}.`,
    );
  }
  if (firstStep.intent_payload.actionType !== actionType) {
    throw new Error(
      `${actionType} persisted actionType=${String(firstStep.intent_payload.actionType)}.`,
    );
  }
  if (first.payload.state === "completed" && !firstStep.result_event_id) {
    throw new Error(`${actionType} completed without a result event.`);
  }
  if (first.payload.state === "waiting" && snapshot.schedules.length === 0) {
    throw new Error(`${actionType} entered waiting without scheduled continuation.`);
  }

  const beforeReplay = await counts(requestId);
  const replay = await request("/v1/persistent-world/actions", {
    method: "POST",
    headers: {
      "idempotency-key": idempotencyKey,
      "x-nocturne-trace-id": `${traceId}-replay`,
    },
    body: JSON.stringify({ actorId, command }),
  });
  if (!replay.response.ok || replay.payload.requestId !== requestId) {
    throw new Error(`${actionType} idempotent replay did not return the original request.`);
  }
  const afterReplay = await counts(requestId);
  if (JSON.stringify(beforeReplay) !== JSON.stringify(afterReplay)) {
    throw new Error(
      `${actionType} idempotent replay changed durable counts: ${JSON.stringify({ beforeReplay, afterReplay })}`,
    );
  }

  return {
    actionType,
    worldKind: capability.worldKind,
    command,
    traceId,
    requestId,
    state: first.payload.state,
    planId: snapshot.request.plan_id,
    stepId: firstStep.step_id,
    eventId: firstStep.result_event_id,
    receiptId: firstStep.result_receipt_id,
    scheduleIds: snapshot.schedules.map((row) => row.schedule_id),
    replayCounts: afterReplay,
  };
}

async function runInfrastructureFailure(actorId: string) {
  const idempotencyKey = `certification:provider-failure:${randomUUID()}`;
  const traceId = `certification-provider-failure-${randomUUID()}`;
  const failed = await request("/v1/persistent-world/actions", {
    method: "POST",
    headers: {
      "idempotency-key": idempotencyKey,
      "x-nocturne-trace-id": traceId,
    },
    body: JSON.stringify({ actorId, command: "[fake:500] I look around the room." }),
  });
  if (failed.response.status !== 502) {
    throw new Error(`Provider failure returned ${failed.response.status}: ${failed.text}`);
  }
  if (!["ai_provider_failure", "ai_provider_rejected"].includes(String(failed.payload.error))) {
    throw new Error(`Provider failure was not classified: ${failed.text}`);
  }
  const rows = await database.client<
    { request_id: string; status: string; plan_id: string | null; error_code: string | null }[]
  >`
    SELECT request_id, status, plan_id, error_code
    FROM game.world_action_requests
    WHERE idempotency_key = ${idempotencyKey}
  `;
  const row = rows[0];
  if (!row || row.status !== "failed" || row.plan_id) {
    throw new Error(`Provider failure committed an invalid durable state: ${JSON.stringify(row)}`);
  }
  return { traceId, requestId: row.request_id, status: row.status, errorCode: row.error_code };
}

await waitForApi();
const actorId = await setupCharacter();
const results = [];
try {
  for (const actionType of ACTION_CAPABILITY_NAMES) {
    results.push(await runAction(actorId, actionType));
  }
  const neutralTransfers = await certifyNeutralTransfers(actorId);
  const providerFailure = await runInfrastructureFailure(actorId);
  const report = {
    status: "passed",
    actorId,
    actionCount: results.length,
    results,
    neutralTransfers,
    providerFailure,
  };
  await writeFile(resultPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await database.close();
}
