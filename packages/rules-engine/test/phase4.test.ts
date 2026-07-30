import { describe, expect, it } from "vitest";
import {
  applyStanding,
  factionAllows,
  factionShift,
  heatFromCrime,
  interceptChance,
  legalStatusAfterHeat,
  resolveIntercept,
  WARRANT_HEAT,
} from "../src/index.js";

describe("phase4 legal", () => {
  it("adds heat on crime", () => {
    expect(heatFromCrime("steal", "failure")).toBeGreaterThan(0);
    expect(heatFromCrime("detect", "complete_success")).toBe(0);
  });

  it("issues warrant and jail at thresholds", () => {
    const w = legalStatusAfterHeat(WARRANT_HEAT, false);
    expect(w.warrant).toBe(true);
    const j = legalStatusAfterHeat(80, true);
    expect(j.jailed).toBe(true);
    expect(j.jailSeconds).toBeGreaterThan(0);
  });
});

describe("phase4 factions", () => {
  it("shifts standing on crime", () => {
    const d = factionShift("steal");
    expect((d.police ?? 0) < 0).toBe(true);
    const s = applyStanding({}, d);
    expect(factionAllows(s, "police", 50)).toBe(false);
  });
});

describe("phase4 comms", () => {
  it("intercept rises with heat", () => {
    expect(interceptChance(0, "complete_success")).toBeLessThan(interceptChance(90, "failure"));
    const r = resolveIntercept(100, "catastrophic_reversal", 0.01);
    expect(r.intercepted).toBe(true);
  });
});
