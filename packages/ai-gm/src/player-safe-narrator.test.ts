import { describe, expect, it } from "vitest";
import { PlayerSafeFactNarrationError, narratePlayerSafeFacts } from "./player-safe-narrator.js";

describe("player-safe fact narration", () => {
  it("accepts prose constrained to committed visible facts", async () => {
    const client = {
      generateText: async () => ({
        text: "You find a bent steel crowbar beneath the workbench.",
        requestedModel: "poolside/laguna-xs-2.1",
        actualModel: "poolside/laguna-xs-2.1",
        provider: "openrouter" as const,
        attempts: 1,
        latencyMs: 10,
      }),
    };
    const result = await narratePlayerSafeFacts(client as never, {
      eventType: "search_discovery",
      outcomeGrade: "complete_success",
      playerVisibleFacts: ["You discover a bent steel crowbar beneath the workbench."],
      constraints: ["Do not claim ownership or possession."],
    });
    expect(result.text).toContain("crowbar");
  });

  it("retries the same Laguna model once after a hard factual guard rejection", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const client = {
      generateText: async (request: Record<string, unknown>) => {
        calls.push(request);
        return {
          text:
            calls.length === 1
              ? "You find the crowbar and it is added to your inventory."
              : "You find the crowbar beneath the workbench.",
          requestedModel: "poolside/laguna-xs-2.1",
          actualModel: "poolside/laguna-xs-2.1",
          provider: "openrouter" as const,
          attempts: 1,
          latencyMs: 10,
        };
      },
    };

    const result = await narratePlayerSafeFacts(client as never, {
      eventType: "search_discovery",
      playerVisibleFacts: ["You discover a crowbar beneath the workbench."],
      constraints: ["Discovery does not establish ownership or possession."],
    });

    expect(result.text).toBe("You find the crowbar beneath the workbench.");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.requestedModel).toBe("poolside/laguna-xs-2.1");
  });

  it("rejects invented possession after discovery", async () => {
    const client = {
      generateText: async () => ({
        text: "You find the crowbar and it is added to your inventory.",
        requestedModel: "poolside/laguna-xs-2.1",
        actualModel: "poolside/laguna-xs-2.1",
        provider: "openrouter" as const,
        attempts: 1,
        latencyMs: 10,
      }),
    };
    await expect(
      narratePlayerSafeFacts(client as never, {
        eventType: "search_discovery",
        playerVisibleFacts: ["You discover a crowbar."],
        constraints: ["Discovery does not establish ownership or possession."],
      }),
    ).rejects.toBeInstanceOf(PlayerSafeFactNarrationError);
  });

  it("rejects invented injury", async () => {
    const client = {
      generateText: async () => ({
        text: "You search the room, trip, and break your wrist.",
        requestedModel: "poolside/laguna-xs-2.1",
        actualModel: "poolside/laguna-xs-2.1",
        provider: "openrouter" as const,
        attempts: 1,
        latencyMs: 10,
      }),
    };
    await expect(
      narratePlayerSafeFacts(client as never, {
        eventType: "search_discovery",
        playerVisibleFacts: ["The search produces no reliable evidence."],
      }),
    ).rejects.toBeInstanceOf(PlayerSafeFactNarrationError);
  });
});
