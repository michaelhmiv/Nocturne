import { describe, expect, it } from "vitest";
import type {
  AffordanceAssessment,
  AffordanceAssessmentRequest,
  WorldActionKind,
} from "@nocturne/contracts";
import { NOCTURNE_GAME_CONSTITUTION } from "./game-constitution.js";
import {
  buildAffordanceAssessmentPrompt,
  validateAffordanceAssessment,
} from "./affordance-adjudicator.js";

const actorId = "10000000-0000-4000-8000-000000000001";
const locationId = "10000000-0000-4000-8000-000000000002";
const allHandlers: WorldActionKind[] = [
  "search",
  "move",
  "consume",
  "relationship",
  "combat",
  "transfer",
  "interact",
  "dialogue",
  "question",
];

function request(command: string): AffordanceAssessmentRequest {
  return {
    command,
    actorId,
    resolvedEntityIds: [],
    enabledHandlers: allHandlers,
    gameMasterContext: {
      constitution: NOCTURNE_GAME_CONSTITUTION,
      currentCommand: command,
      currentScene: {
        locationId,
        locationName: "Foundry Row",
        locationDescription: "An ordinary urban street with municipal fixtures.",
        summary: "The player stands near the curb after eating oatmeal.",
        unresolvedThreads: [],
      },
      recentTurns: [],
      relevantMemories: [],
      playerKnownFacts: [],
      activePlan: null,
      estimatedTokens: 500,
    },
  };
}

function gumAssessment(): AffordanceAssessment {
  return {
    terminalIntent: "consume",
    requiresSearch: false,
    requiresClarification: false,
    rationale: "Eating is the terminal intent; the pole only describes a mundane source.",
    premises: [
      {
        text: "gum",
        concept: "old chewing gum",
        role: "object",
        status: "plausible_ephemeral",
        persistenceReason: "It is low-value and immediately consumed.",
        advantageCategories: ["none"],
        potentialConsequences: ["unpleasant taste", "minor contamination risk"],
      },
      {
        text: "light pole",
        concept: "generic municipal light pole",
        role: "source",
        status: "plausible_ephemeral",
        persistenceReason: "It is incidental scenery and is not changed by the action.",
        advantageCategories: ["none"],
        potentialConsequences: [],
      },
    ],
  };
}

describe("affordance and persistence adjudicator", () => {
  it("accepts gum on a light pole as ephemeral consume context", () => {
    const assessed = validateAffordanceAssessment(
      gumAssessment(),
      request("I eat gum off a light pole."),
    );
    expect(assessed.terminalIntent).toBe("consume");
    expect(assessed.requiresSearch).toBe(false);
    expect(assessed.premises.every((premise) => premise.status === "plausible_ephemeral")).toBe(
      true,
    );
  });

  it("distinguishes an explicit search for gum", () => {
    const assessed = validateAffordanceAssessment(
      {
        ...gumAssessment(),
        terminalIntent: "search",
        requiresSearch: true,
        rationale: "The player is explicitly asking to locate gum.",
      },
      request("I look for gum on a light pole."),
    );
    expect(assessed.terminalIntent).toBe("search");
    expect(assessed.requiresSearch).toBe(true);
  });

  it("rejects a loaded rifle improvised as an ephemeral detail", () => {
    expect(() =>
      validateAffordanceAssessment(
        {
          terminalIntent: "interact",
          requiresSearch: false,
          requiresClarification: false,
          rationale: "The player wants to pick it up.",
          premises: [
            {
              text: "loaded rifle leaning against the pole",
              concept: "loaded rifle",
              role: "object",
              status: "plausible_ephemeral",
              persistenceReason: "Claimed as nearby.",
              advantageCategories: ["none"],
              potentialConsequences: [],
            },
          ],
        },
        request("I grab the loaded rifle leaning against the pole."),
      ),
    ).toThrow(/high-impact premise/i);
  });

  it("requires advantage-bearing premises to remain authoritative", () => {
    expect(() =>
      validateAffordanceAssessment(
        {
          terminalIntent: "interact",
          requiresSearch: false,
          requiresClarification: false,
          rationale: "The player asserts a key exists.",
          premises: [
            {
              text: "the mayor's master key",
              concept: "master key",
              role: "object",
              status: "scene_local",
              persistenceReason: "It might be reused.",
              advantageCategories: ["key", "security_access"],
              potentialConsequences: ["bypass locks"],
            },
          ],
        },
        request("I use the mayor's master key hidden under the pole."),
      ),
    ).toThrow();
  });

  it("makes the terminal-intent and persistence rules explicit in the prompt", () => {
    const prompt = buildAffordanceAssessmentPrompt(request("I eat gum off a light pole."));
    expect(prompt).toContain("terminal intent");
    expect(prompt).toContain("plausible_ephemeral");
    expect(prompt).toContain("weapons");
    expect(prompt).toContain("CURRENT SCENE");
    expect(prompt).toContain("NOCTURNE GAME CONSTITUTION");
  });
});
