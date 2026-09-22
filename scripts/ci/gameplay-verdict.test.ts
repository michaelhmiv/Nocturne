import { describe, expect, it } from "vitest";
import { gameplayOutcomeDefects } from "./gameplay-verdict.js";

const eventId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const positive = {
  state: "completed",
  eventIds: [eventId],
  narration: "You drink the water; the glass is empty.",
  plan: { steps: [{ status: "completed", outcomeGrade: "success" }] },
};
const consumption = {
  effects: { events: [{ eventId, effects: [
    { type: "quantity_changed", change: "consumed", delta: -1 },
  ] }] },
};
describe("real-player positive-outcome gate", () => {
  it("rejects the exact false-green production observation", () => {
    expect(gameplayOutcomeDefects({
      state: "completed",
      requestId: "123",
      eventIds: [],
      narration: "You attempt the action but do not accomplish the objective: I look around the room and take in my surroundings.",
    }, { effects: { events: [] } }, "observation")).toEqual([
      "objective_not_accomplished", "missing_committed_event",
    ]);
  });
  it("rejects the exact false-green production consumption", () => {
    expect(gameplayOutcomeDefects({
      state: "completed", eventIds: [eventId],
      narration: "You attempt to drink a glass of water, but no matching source is available to consume.",
    }, { effects: { events: [{ eventId, effects: [] }] } }, "consumption"))
      .toEqual(["objective_not_accomplished", "consumption_has_no_verified_effect"]);
  });
  it("rejects waiting, failed steps, unlinked receipts and no-effect consumption", () => {
    expect(gameplayOutcomeDefects({ state: "waiting", requestId: "123" }, {}, "observation"))
      .toEqual(["turn_not_completed"]);
    expect(gameplayOutcomeDefects({
      ...positive, plan: { steps: [{ status: "completed", outcomeGrade: "no_effect" }] },
    }, consumption, "consumption")).toContain("step_did_not_succeed");
    expect(gameplayOutcomeDefects(positive, { effects: { events: [] } }, "consumption"))
      .toContain("committed_event_missing_from_player_history");
    expect(gameplayOutcomeDefects(positive, { effects: { events: [{ eventId, effects: [] }] } }, "consumption"))
      .toContain("consumption_has_no_verified_effect");
  });
  it("accepts only a linked committed consumption effect and an accomplished objective", () => {
    expect(gameplayOutcomeDefects(positive, consumption, "consumption")).toEqual([]);
  });
});
