import { z } from "zod";

export const UniversalEventTypeSchema = z.enum([
  "world_state_mutated",
  "action_completed_non_mutating",
  "action_failed",
  "dialogue_occurred",
  "question_asked",
  "clarification_requested",
  "clarification_resolved",
  "action_scheduled",
  "action_cancelled",
  "action_interrupted",
]);
export type UniversalEventType = z.infer<typeof UniversalEventTypeSchema>;

export const NON_MUTATING_EVENT_TYPES = [
  "action_completed_non_mutating",
  "action_failed",
  "dialogue_occurred",
  "question_asked",
  "clarification_requested",
  "clarification_resolved",
  "action_interrupted",
] as const satisfies readonly UniversalEventType[];

export function isNonMutatingEventType(eventType: UniversalEventType) {
  return (NON_MUTATING_EVENT_TYPES as readonly string[]).includes(eventType);
}
