import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import {
  GameplayTelemetryEventSchema,
  type GameplayTelemetryEvent,
  type GameplayTelemetryWriter,
} from "@nocturne/contracts";

export type GameplayLogger = {
  info(payload: Record<string, unknown>, message?: string): void;
  warn(payload: Record<string, unknown>, message?: string): void;
  error(payload: Record<string, unknown>, message?: string): void;
  debug?(payload: Record<string, unknown>, message?: string): void;
};

const gameplayTrace = new AsyncLocalStorage<string>();

export function createGameplayTraceId(candidate?: string | string[]) {
  const value = Array.isArray(candidate) ? candidate[0] : candidate;
  return value?.trim().slice(0, 256) || randomUUID();
}

export function runWithGameplayTrace<T>(traceId: string, operation: () => Promise<T>) {
  return gameplayTrace.run(traceId, operation);
}

export function currentGameplayTraceId(fallback: string) {
  return gameplayTrace.getStore() || fallback;
}

export function hashIdempotencyKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function createGameplayTelemetryWriter(logger: GameplayLogger): GameplayTelemetryWriter {
  return (input: GameplayTelemetryEvent) => {
    const event = GameplayTelemetryEventSchema.parse(input);
    const payload = { telemetry: event };
    if (event.level === "error") logger.error(payload, "gameplay_telemetry");
    else if (event.level === "warn") logger.warn(payload, "gameplay_telemetry");
    else if (event.level === "debug" && logger.debug) logger.debug(payload, "gameplay_telemetry");
    else logger.info(payload, "gameplay_telemetry");
  };
}

export async function writeGameplayTelemetry(
  writer: GameplayTelemetryWriter | undefined,
  input: Omit<GameplayTelemetryEvent, "timestamp"> & { timestamp?: string },
) {
  if (!writer) return;
  await writer(
    GameplayTelemetryEventSchema.parse({
      ...input,
      timestamp: input.timestamp || new Date().toISOString(),
    }),
  );
}
