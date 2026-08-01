import { describe, expect, it } from "vitest";
import {
  AI_TASK_CONTEXT_DECLARATIONS,
  GAME_CONSTITUTION_VERSION,
  NOCTURNE_GAME_CONSTITUTION,
  buildGameConstitutionPrompt,
} from "./game-constitution.js";

const expectedTasks = [
  "parse_intent",
  "normalize_content",
  "analyze_consumable",
  "analyze_ephemeral_consumption",
  "assess_affordances",
  "propose_adjudication",
  "plan_npc",
  "summarize_memory",
  "brainstorm_content",
  "narrate_event",
  "private_assistant",
  "resolve_entity_references",
  "analyze_materialization",
  "analyze_search_discovery",
  "plan_persistent_world_action",
  "simulate_entity_elapsed_time",
];

describe("shared game constitution", () => {
  it("defines the persistent improvisational boundary", () => {
    const prompt = buildGameConstitutionPrompt();
    expect(NOCTURNE_GAME_CONSTITUTION.version).toBe(GAME_CONSTITUTION_VERSION);
    expect(prompt).toContain("improvisational open-world roleplaying game");
    expect(prompt).toContain("Do not create durable entities merely because a noun appears");
    expect(prompt).toContain("weapons, ammunition, credentials, keys, vehicles");
    expect(prompt).toContain("completed low-impact or no-effect in-world resolution");
  });

  it("requires every AI task to declare its context boundary", () => {
    expect(Object.keys(AI_TASK_CONTEXT_DECLARATIONS).sort()).toEqual(expectedTasks.sort());
    expect(AI_TASK_CONTEXT_DECLARATIONS.plan_persistent_world_action).toBe("player_safe_context");
    expect(AI_TASK_CONTEXT_DECLARATIONS.analyze_search_discovery).toBe("authoritative_context");
    expect(AI_TASK_CONTEXT_DECLARATIONS.assess_affordances).toBe("player_safe_context");
    expect(AI_TASK_CONTEXT_DECLARATIONS.analyze_ephemeral_consumption).toBe("player_safe_context");
  });
});
