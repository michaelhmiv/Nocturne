import { describe, expect, it } from "vitest";
import {
  SYSTEM_CAPABILITIES,
  SYSTEM_CAPABILITY_NAMES,
  type SystemCapabilityName,
} from "./system-capabilities.js";

const EXPECTED_SYSTEM_CAPABILITIES: readonly SystemCapabilityName[] = [
  "authentication",
  "selected_character",
  "world_scope",
  "shard_scope",
  "context_compilation",
  "reference_resolution",
  "aliases_and_pronouns",
  "persistent_identity",
  "search_discovery",
  "bounded_materialization",
  "location_materialization",
  "ownership",
  "possession",
  "control",
  "custody",
  "containment",
  "residence",
  "following",
  "travel_cohorts",
  "persistent_plans",
  "plan_supersession",
  "scheduled_work",
  "worker_leases",
  "lazy_simulation",
  "event_ledger",
  "mutation_receipts",
  "resources",
  "conditions",
  "inventory",
  "legal_heat",
  "jail",
  "faction_standing",
  "communications",
  "commerce",
  "crafting",
  "healing",
  "work_paydays",
  "narration",
  "provider_configuration",
  "operator_repair",
  "player_safe_scene",
  "legacy_route_rejection",
];

describe("system capability registry", () => {
  it("contains every declared system capability exactly once", () => {
    expect([...SYSTEM_CAPABILITY_NAMES].sort()).toEqual([...EXPECTED_SYSTEM_CAPABILITIES].sort());
    expect(new Set(SYSTEM_CAPABILITY_NAMES).size).toBe(EXPECTED_SYSTEM_CAPABILITIES.length);
  });

  it.each(EXPECTED_SYSTEM_CAPABILITIES)(
    "defines enforceable certification requirements for %s",
    (name) => {
      const capability = SYSTEM_CAPABILITIES[name];
      expect(capability.requiredScenarios.length).toBeGreaterThan(0);
      expect(capability.requiredInvariants.length).toBeGreaterThan(0);
      expect(capability.requiredLogEvents.length).toBeGreaterThan(0);
      expect(new Set(capability.requiredScenarios).size).toBe(capability.requiredScenarios.length);
    },
  );

  it("requires worker coverage for every asynchronous capability", () => {
    for (const name of [
      "travel_cohorts",
      "persistent_plans",
      "scheduled_work",
      "worker_leases",
      "lazy_simulation",
      "jail",
      "crafting",
    ] as const) {
      expect(SYSTEM_CAPABILITIES[name].workerRequired, name).toBe(true);
    }
  });
});
