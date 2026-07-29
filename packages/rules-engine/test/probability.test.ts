import { describe, expect, it } from "vitest";
import {
  resolveProbabilityCheck,
  validateNocturneProbability,
  type ProbabilityHmacSource,
} from "../src/index.js";

const probability = (band: string, basisPoints: number) => ({
  scale: "nocturne-probability-v1",
  band,
  basisPoints,
});

const input = {
  serverSecret: "test-only-server-secret",
  eventId: "event-1",
  checkOrder: 1,
  checkKind: "primary_action" as const,
  authoritativeProbability: probability("even", 5_000),
};

const digest = (value: number) => {
  const bytes = Buffer.alloc(32);
  bytes.writeUInt32BE(value);
  return bytes;
};

describe("validateNocturneProbability", () => {
  it.each([
    ["impossible", 0],
    ["remote", 1],
    ["remote", 999],
    ["unlikely", 1_000],
    ["unlikely", 3_499],
    ["even", 3_500],
    ["even", 6_499],
    ["likely", 6_500],
    ["likely", 8_999],
    ["near_certain", 9_000],
    ["near_certain", 9_999],
    ["certain", 10_000],
  ])("accepts the %s boundary at %i basis points", (band, basisPoints) => {
    expect(validateNocturneProbability(probability(band, basisPoints)).basisPoints).toBe(
      basisPoints,
    );
  });

  it.each([
    probability("impossible", 1),
    probability("remote", 0),
    probability("unlikely", 999),
    probability("even", 6_500),
    probability("likely", 9_000),
    probability("near_certain", 10_000),
    probability("certain", 9_999),
    probability("even", 5_000.5),
    probability("unknown", 5_000),
    { scale: "other", band: "even", basisPoints: 5_000 },
  ])("fails closed for invalid probability %#", (candidate) => {
    expect(() => validateNocturneProbability(candidate)).toThrow(/invalid probability/i);
    expect(() =>
      resolveProbabilityCheck({ ...input, authoritativeProbability: candidate }),
    ).toThrow(/invalid probability/i);
  });
});

describe("resolveProbabilityCheck", () => {
  it("replays exactly and domain-separates immutable check inputs", () => {
    const original = resolveProbabilityCheck(input);

    expect(resolveProbabilityCheck(input)).toEqual(original);
    expect(resolveProbabilityCheck({ ...input, eventId: "event-2" }).rollBasisPoints).not.toBe(
      original.rollBasisPoints,
    );
    expect(resolveProbabilityCheck({ ...input, checkOrder: 2 }).rollBasisPoints).not.toBe(
      original.rollBasisPoints,
    );
    expect(
      resolveProbabilityCheck({ ...input, checkKind: "hidden_reaction" }).rollBasisPoints,
    ).not.toBe(original.rollBasisPoints);
  });

  it("does not roll terminal probabilities", () => {
    let calls = 0;
    const hmacSource: ProbabilityHmacSource = () => {
      calls += 1;
      return digest(0);
    };

    expect(
      resolveProbabilityCheck({
        ...input,
        authoritativeProbability: probability("impossible", 0),
        hmacSource,
      }),
    ).toEqual({
      success: false,
      rollBasisPoints: null,
      marginBasisPoints: null,
      outcomeGrade: "failure",
    });
    expect(
      resolveProbabilityCheck({
        ...input,
        authoritativeProbability: probability("certain", 10_000),
        hmacSource,
      }),
    ).toEqual({
      success: true,
      rollBasisPoints: null,
      marginBasisPoints: null,
      outcomeGrade: "complete_success",
    });
    expect(calls).toBe(0);
  });

  it("returns an auditable margin and deterministic outcome grade", () => {
    const cases = [
      [3_000, 2_000, "complete_success"],
      [4_500, 500, "success_with_consequence"],
      [4_501, 499, "partial_success"],
      [4_999, 1, "partial_success"],
      [5_000, 0, "partial_success"],
      [5_499, -499, "failure_with_progress"],
      [5_500, -500, "failure"],
      [6_999, -1_999, "failure"],
      [7_000, -2_000, "catastrophic_reversal"],
    ] as const;

    for (const [roll, marginBasisPoints, outcomeGrade] of cases) {
      expect(
        resolveProbabilityCheck({ ...input, hmacSource: () => digest(roll - 1) }),
      ).toMatchObject({
        marginBasisPoints,
        outcomeGrade,
      });
    }
  });

  it("uses rejection sampling and succeeds only at or below authoritative basis points", () => {
    let calls = 0;
    const hmacSource: ProbabilityHmacSource = () =>
      digest([4_294_960_000, 4_999, 5_000][calls++] ?? 0);

    expect(resolveProbabilityCheck({ ...input, hmacSource })).toEqual({
      success: true,
      rollBasisPoints: 5_000,
      marginBasisPoints: 0,
      outcomeGrade: "partial_success",
    });
    expect(calls).toBe(2);
    expect(resolveProbabilityCheck({ ...input, hmacSource })).toEqual({
      success: false,
      rollBasisPoints: 5_001,
      marginBasisPoints: -1,
      outcomeGrade: "failure_with_progress",
    });

    let exhaustedCalls = 0;
    expect(() =>
      resolveProbabilityCheck({
        ...input,
        hmacSource: () => {
          exhaustedCalls += 1;
          return digest(4_294_960_000);
        },
      }),
    ).toThrow(/sampling exhausted/i);
    expect(exhaustedCalls).toBe(128);
  });

  it("rejects malformed roll identity and never exposes secret or hash material", () => {
    for (const candidate of [
      { ...input, serverSecret: "" },
      { ...input, eventId: "" },
      { ...input, checkOrder: 0 },
      { ...input, checkOrder: 1.5 },
      { ...input, checkKind: "other" as "primary_action" },
    ]) {
      expect(() => resolveProbabilityCheck(candidate)).toThrow(/invalid probability check/i);
    }

    expect(Object.keys(resolveProbabilityCheck(input)).sort()).toEqual([
      "marginBasisPoints",
      "outcomeGrade",
      "rollBasisPoints",
      "success",
    ]);
    expect(JSON.stringify(resolveProbabilityCheck(input))).not.toContain(input.serverSecret);
  });

  it("is statistically sane across deterministic event IDs", () => {
    const buckets = Array.from({ length: 10 }, () => 0);
    let successes = 0;
    for (let index = 0; index < 20_000; index += 1) {
      const result = resolveProbabilityCheck({ ...input, eventId: `stat-${index}` });
      const roll = result.rollBasisPoints as number;
      buckets[Math.floor((roll - 1) / 1_000)]! += 1;
      if (result.success) successes += 1;
    }

    expect(successes).toBeGreaterThan(9_700);
    expect(successes).toBeLessThan(10_300);
    for (const count of buckets) {
      expect(count).toBeGreaterThan(1_800);
      expect(count).toBeLessThan(2_200);
    }
  });
});
