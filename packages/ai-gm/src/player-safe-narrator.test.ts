import { describe, expect, it } from "vitest";
import { PlayerSafeFactNarrationError, narratePlayerSafeFacts } from "./player-safe-narrator.js";

describe("player-safe fact narration", () => {
  it("accepts prose constrained to committed visible facts", async () => {
    const client = {
      generateText: async () => ({
        text: "You find a bent steel crowbar beneath the workbench.",
        requestedModel: "qwen/qwen3.7-flash",
        actualModel: "qwen/qwen3.7-flash",
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

  it("rejects invented possession after discovery", async () => {
    const client = {
      generateText: async () => ({
        text: "You find the crowbar and it is added to your inventory.",
        requestedModel: "qwen/qwen3.7-flash",
        actualModel: "qwen/qwen3.7-flash",
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
        requestedModel: "qwen/qwen3.7-flash",
        actualModel: "qwen/qwen3.7-flash",
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
