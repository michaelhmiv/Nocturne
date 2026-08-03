import { describe, expect, it } from "vitest";
import { UniversalEventTypeSchema, isNonMutatingEventType } from "./event-taxonomy.js";

describe("universal event taxonomy", () => {
  it("distinguishes world mutations from dialogue and failed attempts", () => {
    expect(UniversalEventTypeSchema.parse("world_state_mutated")).toBe("world_state_mutated");
    expect(isNonMutatingEventType("dialogue_occurred")).toBe(true);
    expect(isNonMutatingEventType("action_failed")).toBe(true);
    expect(isNonMutatingEventType("world_state_mutated")).toBe(false);
    expect(isNonMutatingEventType("action_scheduled")).toBe(false);
  });

  it("rejects legacy generic mutation labels as new classifications", () => {
    expect(UniversalEventTypeSchema.safeParse("world_mutation").success).toBe(false);
  });
});
