import { describe, expect, it } from "vitest";
import {
  KNOWN_MCP_PRODUCTION_REGRESSION_IDS,
  KNOWN_MCP_PRODUCTION_REGRESSIONS,
} from "../scripts/ci/mcp-known-regressions.mjs";

const EXPECTED_IDS = [
  "missing-sandwich-no-mutation",
  "missing-pistol-cannot-discharge",
  "missing-knife-before-secondary-clarification",
  "bare-fist-is-anatomy",
  "dialogue-claim-does-not-create-ownership",
  "clarification-reply-resumes-original-request",
  "failed-movement-terminalizes",
  "explicit-two-minute-exercise-real-time",
  "starter-unit-route-connected",
  "search-materializes-discovery",
  "current-unit-deixis",
  "unique-vehicle-insufficient-funds",
  "certification-entities-inspectable",
  "idempotent-replay-original-records",
  "idempotency-conflict-rejected",
];

describe("known MCP production regression catalog", () => {
  it("contains exactly the 15 release-gate regressions from epic #113", () => {
    expect(KNOWN_MCP_PRODUCTION_REGRESSION_IDS).toEqual(EXPECTED_IDS);
    expect(new Set(KNOWN_MCP_PRODUCTION_REGRESSION_IDS).size).toBe(15);
  });

  it("requires authoritative evidence instead of narration-only assertions", () => {
    for (const regression of KNOWN_MCP_PRODUCTION_REGRESSIONS) {
      expect(regression.title.trim().length).toBeGreaterThan(0);
      expect(regression.oracle.trim().length).toBeGreaterThan(0);
      expect(regression.evidence.length).toBeGreaterThan(0);
      expect(
        regression.evidence.some((entry) =>
          [
            "operator_trace",
            "entity_version",
            "event_history",
            "entity_inspection",
            "dashboard",
            "scene",
            "travel_path",
            "vehicle_listing",
            "schedule",
          ].includes(entry),
        ),
        `${regression.id} must require authoritative evidence`,
      ).toBe(true);
    }
  });

  it("preserves the timing and idempotency contracts explicitly", () => {
    const timed = KNOWN_MCP_PRODUCTION_REGRESSIONS.find(
      ({ id }) => id === "explicit-two-minute-exercise-real-time",
    );
    expect(timed?.durationSeconds).toBe(120);
    expect(timed?.oracle).toBe("real_time_120_seconds");

    expect(
      KNOWN_MCP_PRODUCTION_REGRESSIONS.find(({ id }) => id === "idempotent-replay-original-records")
        ?.prompts,
    ).toHaveLength(1);
    expect(
      KNOWN_MCP_PRODUCTION_REGRESSIONS.find(({ id }) => id === "idempotency-conflict-rejected")
        ?.prompts,
    ).toHaveLength(2);
  });

  it("keeps player actions as natural-language MCP intent", () => {
    for (const regression of KNOWN_MCP_PRODUCTION_REGRESSIONS) {
      for (const prompt of regression.prompts) {
        expect(typeof prompt).toBe("string");
        expect(prompt.trim().length).toBeGreaterThan(2);
        expect(prompt).not.toMatch(/^[a-z_]+\([^)]*\)$/i);
      }
    }
  });
});
