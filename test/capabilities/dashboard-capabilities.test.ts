import { describe, expect, it } from "vitest";
import {
  DASHBOARD_CAPABILITIES,
  DASHBOARD_CAPABILITY_NAMES,
  type DashboardCapabilityName,
} from "./dashboard-capabilities.js";

const EXPECTED_CAPABILITIES = [
  "player_effect_projection",
  "player_dashboard",
  "operator_world_inspector",
] as const satisfies readonly DashboardCapabilityName[];

describe("dashboard capability registry", () => {
  it("is exhaustive for every dashboard capability", () => {
    expect([...DASHBOARD_CAPABILITY_NAMES].sort()).toEqual([...EXPECTED_CAPABILITIES].sort());
  });

  it.each(EXPECTED_CAPABILITIES)("certifies %s with scenarios and invariants", (name) => {
    const capability = DASHBOARD_CAPABILITIES[name];
    expect(capability.requiredScenarios.length).toBeGreaterThan(0);
    expect(capability.requiredInvariants.length).toBeGreaterThan(0);
    expect(capability.requiredEndpoints.length).toBeGreaterThan(0);
    expect(capability.requiredSurfaces.length).toBeGreaterThan(0);
    expect(capability.workerRequired).toBe(false);
  });

  it("requires a browser path for both player-facing projections", () => {
    expect(DASHBOARD_CAPABILITIES.player_effect_projection.browserRequired).toBe(true);
    expect(DASHBOARD_CAPABILITIES.player_dashboard.browserRequired).toBe(true);
    expect(DASHBOARD_CAPABILITIES.operator_world_inspector.browserRequired).toBe(false);
  });

  it("requires strict operator separation", () => {
    expect(DASHBOARD_CAPABILITIES.operator_world_inspector.requiredScenarios).toContain(
      "player_rejected",
    );
    expect(DASHBOARD_CAPABILITIES.operator_world_inspector.requiredInvariants).toContain(
      "ordinary players cannot access authoritative inspector payloads",
    );
  });
});
