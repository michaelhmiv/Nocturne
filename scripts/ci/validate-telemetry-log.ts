import { readFile, writeFile } from "node:fs/promises";
import {
  GameplayTelemetryEventSchema,
  type GameplayTelemetryEvent,
  type GameplayTelemetryEventName,
} from "../../packages/contracts/src/index.js";
import { ACTION_CAPABILITIES } from "../../test/capabilities/action-capabilities.js";

const logPath = process.env.API_LOG_PATH || "artifacts/api.ndjson";
const resultsPath =
  process.env.ACTION_INTEGRATION_RESULTS || "artifacts/action-integration-results.json";
const reportPath = process.env.TELEMETRY_REPORT || "artifacts/telemetry-report.json";

const logText = await readFile(logPath, "utf8");
const result = JSON.parse(await readFile(resultsPath, "utf8")) as {
  results: {
    actionType: keyof typeof ACTION_CAPABILITIES;
    traceId: string;
    requestId: string;
    state: "completed" | "waiting";
  }[];
  providerFailure: { traceId: string; requestId: string };
};

const telemetry: GameplayTelemetryEvent[] = [];
const malformed: { line: number; error: string; value: unknown }[] = [];
for (const [index, line] of logText.split(/\r?\n/).entries()) {
  if (!line.trim().startsWith("{")) continue;
  try {
    const decoded = JSON.parse(line) as Record<string, unknown>;
    if (!decoded.telemetry) continue;
    const parsed = GameplayTelemetryEventSchema.safeParse(decoded.telemetry);
    if (!parsed.success) {
      malformed.push({ line: index + 1, error: parsed.error.message, value: decoded.telemetry });
    } else {
      telemetry.push(parsed.data);
    }
  } catch {
    // Non-JSON process output is allowed; JSON telemetry records are not.
  }
}
if (malformed.length) {
  throw new Error(`Malformed gameplay telemetry: ${JSON.stringify(malformed.slice(0, 10))}`);
}

const reports = [];
for (const action of result.results) {
  const events = telemetry.filter((event) => event.traceId === action.traceId);
  const names = events.map((event) => event.eventName);
  const required = new Set<GameplayTelemetryEventName>(
    ACTION_CAPABILITIES[action.actionType].requiredLogEvents,
  );
  if (action.state === "waiting") {
    required.delete("event_committed");
    required.delete("step_completed");
    required.delete("request_completed");
    required.add("schedule_created");
    required.add("step_waiting");
    required.add("request_waiting");
  } else {
    required.delete("schedule_created");
    required.delete("step_waiting");
    required.delete("request_waiting");
  }
  const missing = [...required].filter((eventName) => !names.includes(eventName));
  const failures = events.filter((event) => event.status === "failed");
  if (missing.length || failures.length) {
    throw new Error(
      `${action.actionType} telemetry invalid: ${JSON.stringify({ missing, failures, names })}`,
    );
  }
  const traces = new Set(events.map((event) => event.traceId));
  const requestIds = new Set(events.map((event) => event.requestId).filter(Boolean));
  if (traces.size !== 1 || (requestIds.size > 0 && !requestIds.has(action.requestId))) {
    throw new Error(
      `${action.actionType} telemetry correlation failed: ${JSON.stringify({ traces: [...traces], requestIds: [...requestIds], expected: action.requestId })}`,
    );
  }
  reports.push({
    actionType: action.actionType,
    traceId: action.traceId,
    requestId: action.requestId,
    eventCount: events.length,
    events: names,
  });
}

const failureEvents = telemetry.filter((event) => event.traceId === result.providerFailure.traceId);
const failureNames = failureEvents.map((event) => event.eventName);
for (const required of ["provider_call_failed", "request_failed"] as const) {
  if (!failureNames.includes(required)) {
    throw new Error(`Provider failure is missing ${required}: ${JSON.stringify(failureNames)}`);
  }
}
if (failureEvents.some((event) => event.committed)) {
  throw new Error(
    `Provider failure telemetry claimed committed state: ${JSON.stringify(failureEvents)}`,
  );
}

const output = {
  status: "passed",
  actionCount: reports.length,
  telemetryEventCount: telemetry.length,
  actions: reports,
  providerFailure: {
    traceId: result.providerFailure.traceId,
    requestId: result.providerFailure.requestId,
    events: failureNames,
  },
};
await writeFile(reportPath, JSON.stringify(output, null, 2));
console.log(JSON.stringify(output, null, 2));
