import { describe, expect, it } from "vitest";
import type { ConsumptionAnalysisRequest } from "@nocturne/contracts";
import { decideConsumableFastPath } from "./consumable-decision.js";

const sourceId = "00000000-0000-4000-8000-000000000101";
const actorId = "00000000-0000-4000-8000-000000000102";

function input(name = "water"): ConsumptionAnalysisRequest {
  return {
    actorId,
    rawText: `drink two units of ${name}`,
    locationName: "Kitchen",
    locationDescription: "An ordinary kitchen.",
    actorState: {},
    candidates: [
      {
        sourceType: "ambient_pool",
        sourceId,
        name,
        description: `Ordinary household ${name}.`,
        access: "ambient",
        quantity: 10,
        state: {},
        constraints: [],
      },
    ],
  };
}

function client(kind: string, consumable = 0.98) {
  return {
    decide: async () => ({
      answers: {
        source: { type: "choice" as const, choice: "source_0", confidence: 0.98 },
        consumable: { type: "noul" as const, noul: consumable },
        substance_kind: { type: "choice" as const, choice: kind, confidence: 0.96 },
        freshness: { type: "choice" as const, choice: "ordinary", confidence: 0.9 },
      },
      requestedModel: "~typesafe/jev-latest",
      actualModel: "typesafe/jev-1.13",
      provider: "openrouter" as const,
      latencyMs: 200,
    }),
  };
}

describe("Jev consumable fast path", () => {
  it("handles ordinary drinks without a generative semantic-analysis call", async () => {
    const result = await decideConsumableFastPath(client("nonalcoholic_drink") as never, input());
    expect(result.fastPathEligible).toBe(true);
    expect(result.analysis?.consumeUnits).toBe(2);
    expect(result.analysis?.resourceDeltas).toEqual([
      expect.objectContaining({ resource: "hydration", delta: 10 }),
    ]);
    expect(result.analysis?.materialization?.unitsCreated).toBe(2);
  });

  it("escalates medicine to rich semantic generation", async () => {
    const result = await decideConsumableFastPath(client("medicine") as never, input("medicine"));
    expect(result.fastPathEligible).toBe(false);
    expect(result.analysis).toBeNull();
    expect(result.fallbackReason).toBe("rich_semantics_required:medicine");
  });

  it("handles definitely non-consumable supplied sources without generation", async () => {
    const result = await decideConsumableFastPath(
      client("nonconsumable", 0.01) as never,
      input("rock"),
    );
    expect(result.fastPathEligible).toBe(true);
    expect(result.analysis?.classification.consumable).toBe(false);
    expect(result.analysis?.consumeUnits).toBe(0);
  });
});
