import { describe, expect, it, vi } from "vitest";
import {
  createCommittedEventNarrator,
  type CommittedEventNarrationEvidence,
} from "./committed-event-narrator.js";

const scope = {
  worldId: "11111111-1111-4111-8111-111111111111",
  shardId: "22222222-2222-4222-8222-222222222222",
  userId: "user",
  role: "player" as const,
  selectedCharacterId: "33333333-3333-4333-8333-333333333333",
};
const actorId = scope.selectedCharacterId;
const eventId = "44444444-4444-4444-8444-444444444444";
const evidence: CommittedEventNarrationEvidence = {
  eventId,
  eventType: "action_failed",
  worldId: scope.worldId,
  shardId: scope.shardId,
  actorId,
  playerVisibleFacts: ["The purchase failed. No money or stock changed."],
};

function setup(rows = [evidence]) {
  const generateText = vi.fn().mockResolvedValue({
    text: "The purchase fails; your cash and the shop's stock remain unchanged.",
    requestedModel: "poolside/laguna-xs-2.1",
    actualModel: "poolside/laguna-xs-2.1",
  });
  const readEvidence = vi.fn().mockResolvedValue(rows);
  const onFailure = vi.fn();
  const narrate = createCommittedEventNarrator({
    client: { generateText } as never,
    readEvidence,
    onFailure,
  });
  return { narrate, generateText, readEvidence, onFailure };
}

describe("committed-event Laguna narration", () => {
  it("narrates only facts from committed actor-scoped receipts", async () => {
    const { narrate, generateText, readEvidence, onFailure } = setup();
    const text = await narrate({ scope, actorId, eventIds: [eventId], fallback: "Fallback" });
    expect(text).toMatch(/purchase fails/i);
    expect(readEvidence).toHaveBeenCalledWith({
      scope,
      actorId,
      eventIds: [eventId],
      fallback: "Fallback",
    });
    expect(generateText).toHaveBeenCalledOnce();
    expect(generateText.mock.calls[0]![0].task).toBe("narrate_event");
    expect(JSON.stringify(generateText.mock.calls[0]![0])).toContain("No money or stock changed");
    expect(onFailure).not.toHaveBeenCalled();
  });

  it("never invokes Laguna before an event has committed", async () => {
    const { narrate, generateText, readEvidence } = setup();
    expect(await narrate({ scope, actorId, eventIds: [], fallback: "Still waiting" })).toBe(
      "Still waiting",
    );
    expect(generateText).not.toHaveBeenCalled();
    expect(readEvidence).not.toHaveBeenCalled();
  });

  it.each([
    ["cross-world", [{ ...evidence, worldId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }]],
    ["cross-actor", [{ ...evidence, actorId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }]],
    ["missing receipt", []],
    ["empty visible facts", [{ ...evidence, playerVisibleFacts: [] }]],
  ] as [string, CommittedEventNarrationEvidence[]][])(
    "does not narrate %s",
    async (_name, rows) => {
      const { narrate, generateText, onFailure } = setup([...rows]);
      expect(
        await narrate({ scope, actorId, eventIds: [eventId], fallback: "Committed fallback" }),
      ).toBe("Committed fallback");
      expect(generateText).not.toHaveBeenCalled();
      expect(onFailure).toHaveBeenCalledOnce();
    },
  );

  it("rejects an unsupported arrest in both Laguna drafts", async () => {
    const { narrate, generateText, onFailure } = setup();
    generateText.mockResolvedValue({ text: "You are arrested." });
    const text = await narrate({ scope, actorId, eventIds: [eventId], fallback: "Fallback" });
    expect(text).toBe(evidence.playerVisibleFacts.join(" "));
    expect(generateText).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledOnce();
  });

  it("returns committed facts and reports a failed provider rather than inventing prose", async () => {
    const { narrate, generateText, onFailure } = setup();
    generateText.mockRejectedValueOnce(new Error("Laguna unavailable"));
    const result = await narrate({ scope, actorId, eventIds: [eventId], fallback: "Fallback" });
    expect(result).toBe(evidence.playerVisibleFacts.join(" "));
    expect(onFailure).toHaveBeenCalledOnce();
  });
});
