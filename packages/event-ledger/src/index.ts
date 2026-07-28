import type { WorldEvent } from "@nocturne/contracts";

export interface AppendEventInput extends Omit<WorldEvent, "eventId"> {
  idempotencyKey: string;
}

export interface EventLedger {
  append(input: AppendEventInput): Promise<WorldEvent>;
  get(eventId: string): Promise<WorldEvent | null>;
  listForEntity(entityId: string, limit?: number): Promise<WorldEvent[]>;
}

export class DuplicateEventError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(`An event already exists for idempotency key ${idempotencyKey}.`);
  }
}
