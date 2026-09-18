import { describe, expect, it } from "vitest";
import type { ConsumptionAnalysisRequest } from "@nocturne/contracts";
import { decideConsumableFastPath } from "./consumable-decision.js";

const sourceId = "00000000-0000-4000-8000-000000000101";
const actorId = "00000000-0000-4000-8000-000000000102";

function input(
  name = "water",
  overrides: Partial<ConsumptionAnalysisRequest["candidates"][number]> = {},
): ConsumptionAnalysisRequest {
  return {
    actorId,
    rawText: `drink two units of ${name}`,
    locationName: "Kitchen",
    locationDescription: "An ordinary kitchen.",
    actorState: { condition: 80 },
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
        ...overrides,
      },
    ],
  };
}

function defaultProfile(kind: string) {
  if (kind === "ordinary_food") return "nourishment";
  if (kind === "nonalcoholic_drink") return "hydration";
  if (kind === "alcohol") return "intoxicating";
  if (kind === "medicine") return "analgesic";
  if (kind === "drug") return "stimulant";
  if (kind === "toxic_substance") return "toxic_systemic";
  if (kind === "nonconsumable") return "neutral";
  return "unknown";
}

function client(
  kind: string,
  options: {
    consumable?: number;
    effectProfile?: string;
    effectConfidence?: number;
    potency?: number;
    risk?: number;
    freshness?: string;
    sourceConfidence?: number;
  } = {},
) {
  return {
    decide: async () => ({
      answers: {
        source: {
          type: "choice" as const,
          choice: "source_0",
          confidence: options.sourceConfidence ?? 0.98,
        },
        consumable: {
          type: "noul" as const,
          noul: options.consumable ?? 0.98,
        },
        substance_kind: { type: "choice" as const, choice: kind, confidence: 0.96 },
        freshness: {
          type: "choice" as const,
          choice: options.freshness ?? "ordinary",
          confidence: 0.9,
        },
        effect_profile: {
          type: "choice" as const,
          choice: options.effectProfile ?? defaultProfile(kind),
          confidence: options.effectConfidence ?? 0.92,
        },
        potency: {
          type: "score" as const,
          score: options.potency ?? 2,
          confidence: 0.9,
        },
        adverse_risk: {
          type: "score" as const,
          score: options.risk ?? 1,
          confidence: 0.9,
        },
      },
      requestedModel: "~typesafe/jev-latest",
      actualModel: "typesafe/jev-1.13",
      provider: "openrouter" as const,
      latencyMs: 200,
    }),
  };
}

describe("Jev consumable semantics", () => {
  it("handles ordinary drinks without generative semantic analysis", async () => {
    const result = await decideConsumableFastPath(
      client("nonalcoholic_drink") as never,
      input(),
    );
    expect(result.fastPathEligible).toBe(true);
    expect(result.analysis?.consumeUnits).toBe(2);
    expect(result.analysis?.resourceDeltas).toEqual([
      expect.objectContaining({ resource: "hydration", delta: 10 }),
    ]);
    expect(result.analysis?.materialization?.unitsCreated).toBe(2);
  });

  it("models medicine as a bounded temporary effect rather than instant healing", async () => {
    const result = await decideConsumableFastPath(
      client("medicine", { effectProfile: "analgesic", potency: 2, risk: 1 }) as never,
      input("pain medicine", {
        sourceType: "entity",
        access: "carried",
        description: "An over-the-counter pain medicine.",
      }),
    );

    expect(result.fastPathEligible).toBe(true);
    expect(result.analysis?.classification.substanceKind).toBe("medicine");
    expect(result.analysis?.resourceDeltas).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ resource: "condition" })]),
    );
    expect(result.analysis?.conditions).toEqual([
      expect.objectContaining({
        key: "analgesic_effect",
        intensity: 2,
      }),
    ]);
    expect(result.analysis?.risks[0]).toEqual(
      expect.objectContaining({
        description: "Adverse reaction",
      }),
    );
  });

  it("models alcohol as intoxication with deterministic risk metadata", async () => {
    const result = await decideConsumableFastPath(
      client("alcohol", {
        effectProfile: "intoxicating",
        potency: 3,
        risk: 2,
      }) as never,
      input("whiskey", {
        sourceType: "entity",
        access: "carried",
        description: "A bottle of strong whiskey.",
      }),
    );

    expect(result.fastPathEligible).toBe(true);
    expect(result.analysis?.conditions).toEqual([
      expect.objectContaining({
        key: "intoxicated",
        intensity: -3,
      }),
    ]);
    expect(result.analysis?.risks[0]?.chanceBasisPoints).toBeGreaterThan(0);
  });

  it("models systemic toxin harm with bounded deterministic effects", async () => {
    const result = await decideConsumableFastPath(
      client("toxic_substance", {
        effectProfile: "toxic_systemic",
        potency: 4,
        risk: 4,
      }) as never,
      input("poison", {
        sourceType: "entity",
        access: "visible",
        description: "A clearly labeled systemic poison.",
      }),
    );

    expect(result.fastPathEligible).toBe(true);
    expect(result.analysis?.resourceDeltas).toEqual([
      expect.objectContaining({
        resource: "condition",
        delta: -24,
      }),
    ]);
    expect(result.analysis?.conditions).toEqual([
      expect.objectContaining({ key: "poisoned" }),
    ]);
    expect(result.analysis?.risks[0]?.chanceBasisPoints).toBeLessThanOrEqual(8000);
  });

  it("adds spoilage risk without converting ordinary food into certain injury", async () => {
    const result = await decideConsumableFastPath(
      client("ordinary_food", {
        effectProfile: "nourishment",
        freshness: "spoiled",
        risk: 2,
      }) as never,
      input("sandwich", {
        sourceType: "entity",
        access: "carried",
        description: "A sandwich with visible spoilage.",
      }),
    );

    expect(result.fastPathEligible).toBe(true);
    expect(result.analysis?.resourceDeltas).toEqual([
      expect.objectContaining({ resource: "satiety", delta: 10 }),
    ]);
    expect(result.analysis?.conditions).toEqual([]);
    expect(result.analysis?.risks).toEqual([
      expect.objectContaining({ description: "Foodborne illness" }),
    ]);
  });

  it("handles definitely non-consumable supplied sources without generation", async () => {
    const result = await decideConsumableFastPath(
      client("nonconsumable", { consumable: 0.01 }) as never,
      input("rock"),
    );
    expect(result.fastPathEligible).toBe(true);
    expect(result.analysis?.classification.consumable).toBe(false);
    expect(result.analysis?.consumeUnits).toBe(0);
  });

  it("requests clarification instead of inventing effects for an unknown fictional substance", async () => {
    const result = await decideConsumableFastPath(
      client("unusual_or_unknown", {
        effectProfile: "unknown",
        effectConfidence: 0.45,
      }) as never,
      input("glimmer gel", {
        sourceType: "entity",
        access: "carried",
        description: "A fictional substance with no documented physiological properties.",
      }),
    );
    expect(result.fastPathEligible).toBe(false);
    expect(result.analysis).toBeNull();
    expect(result.fallbackReason).toBe("unknown_substance_semantics");
  });

  it("rejects low-confidence source selection instead of choosing silently", async () => {
    const result = await decideConsumableFastPath(
      client("nonalcoholic_drink", { sourceConfidence: 0.4 }) as never,
      input("water"),
    );
    expect(result.fastPathEligible).toBe(false);
    expect(result.analysis).toBeNull();
    expect(result.fallbackReason).toBe("low_decision_confidence");
  });
});
