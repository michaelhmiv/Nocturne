import { describe, expect, it } from "vitest";
import {
  ACTION_TYPES,
  type ActionType,
} from "../packages/rules-engine/src/actions.js";
import {
  auditSignalGardenCampaign,
  createInitialSignalGardenState,
  createSignalGardenTurn,
  generateSignalGardenCampaign,
  applySignalGardenTurn,
  SIGNAL_GARDEN_SIGNATURE_ACTION,
  SIGNAL_GARDEN_TURN_COUNT,
} from "../scripts/ci/signal-garden-campaign.js";

describe("Signal Garden 5,000-turn campaign contract", () => {
  it("generates a reproducible, unique 5,000-turn story", () => {
    const first = generateSignalGardenCampaign({
      turns: SIGNAL_GARDEN_TURN_COUNT,
      seed: "contract-seed",
    });
    const second = generateSignalGardenCampaign({
      turns: SIGNAL_GARDEN_TURN_COUNT,
      seed: "contract-seed",
    });
    expect(first).toEqual(second);

    const audit = auditSignalGardenCampaign(first);
    expect(audit.errors).toEqual([]);
    expect(audit.commandCount).toBe(5_000);
    expect(audit.packetCount).toBe(5_000);
    expect(audit.playerCount).toBe(3);
    expect(audit.signatureTurns).toHaveLength(200);
    expect(Object.keys(audit.actionCounts).sort()).toEqual([...ACTION_TYPES].sort());
    expect(new Set(first.map((turn) => turn.command)).size).toBe(5_000);
  });

  it("uses all action families and embeds the unique public-signal relay", () => {
    const campaign = generateSignalGardenCampaign({ turns: 500 });
    const counts = new Map<ActionType, number>();
    for (const turn of campaign) {
      counts.set(turn.actionType, (counts.get(turn.actionType) || 0) + 1);
      expect(turn.command).toContain(turn.packetId);
      expect(turn.command).toContain(turn.phase);
      if (turn.signatureAction) {
        expect(turn.actionType).toBe("hack");
        expect(turn.command).toContain("Signal Garden relay kiosk");
        expect(turn.command).toContain("auditable public evidence trail");
      }
    }
    for (const actionType of ACTION_TYPES) expect(counts.get(actionType)).toBeGreaterThan(0);
    expect(campaign.filter((turn) => turn.signatureAction)).toHaveLength(20);
    expect(SIGNAL_GARDEN_SIGNATURE_ACTION).toBe("relay_public_signal");
  });

  it("advances a bounded state machine without skipping turns", () => {
    const campaign = generateSignalGardenCampaign({ turns: 75, seed: "state-seed" });
    let state = createInitialSignalGardenState();
    for (const turn of campaign) {
      state = applySignalGardenTurn(state, turn, {
        state: turn.signatureAction ? "completed" : "waiting",
        eventIds: turn.signatureAction ? ["event-" + turn.sequence] : [],
      });
      expect(state.version).toBe(turn.sequence + 1);
    }
    expect(state.version).toBe(75);
    expect(state.relayCount).toBe(3);
    expect(Object.keys(state.packets)).toHaveLength(75);
    expect(state.publicTrust).toBeGreaterThan(0);
  });

  it("fails closed when a caller tries to skip or replay a sequence", () => {
    const first = createSignalGardenTurn(0, "guard-seed");
    const state = createInitialSignalGardenState();
    expect(() =>
      applySignalGardenTurn(state, createSignalGardenTurn(1, "guard-seed"), {
        state: "completed",
        eventIds: [],
      }),
    ).toThrow(/expected turn 0/);
    expect(first.packetId).not.toBe(createSignalGardenTurn(1, "guard-seed").packetId);
  });
});
