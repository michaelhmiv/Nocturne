import type { SystemCapability } from "./system-capabilities.js";

export type DashboardCapabilityName =
  "player_effect_projection" | "player_dashboard" | "operator_world_inspector";

export interface DashboardCapability extends SystemCapability {
  requiredEndpoints: readonly [string, ...string[]];
  requiredSurfaces: readonly [string, ...string[]];
}

function dashboardCapability(
  input: Omit<DashboardCapability, "requiredLogEvents" | "workerRequired">,
): DashboardCapability {
  return {
    ...input,
    requiredLogEvents: [],
    workerRequired: false,
  };
}

export const DASHBOARD_CAPABILITIES = {
  player_effect_projection: dashboardCapability({
    requiredScenarios: [
      "consumption_resource_delta",
      "condition_application",
      "risk_resolution",
      "quantity_consumed",
      "location_change",
      "relationship_change",
      "event_without_exposed_effects",
    ],
    requiredInvariants: [
      "effects derive only from committed event payloads and receipts",
      "effect history is selected-character and world scoped",
      "effect projection never independently adjudicates mechanics",
    ],
    requiredEndpoints: ["GET /v1/persistent-world/effects"],
    requiredSurfaces: ["action effect summary", "history feed"],
    browserRequired: true,
  }),
  player_dashboard: dashboardCapability({
    requiredScenarios: [
      "current_condition",
      "current_resources",
      "active_conditions",
      "inventory",
      "location_hierarchy",
      "active_plan",
      "scheduled_work",
      "nearby_entities",
      "known_entities_elsewhere",
      "resource_history",
      "mobile_layout",
    ],
    requiredInvariants: [
      "current state and history share authoritative event identifiers",
      "hidden state and raw AI analysis are excluded",
      "dashboard actor is controlled and selected in the resolved world scope",
    ],
    requiredEndpoints: ["GET /v1/persistent-world/dashboard"],
    requiredSurfaces: [
      "/dashboard overview",
      "/dashboard character",
      "/dashboard inventory",
      "/dashboard world",
      "/dashboard history",
    ],
    browserRequired: true,
  }),
  operator_world_inspector: dashboardCapability({
    requiredScenarios: [
      "owner_access",
      "operator_access",
      "player_rejected",
      "request_stage_correlation",
      "entity_state",
      "relations",
      "events",
      "plans_and_schedules",
      "simulation_runs",
      "context_inclusion_reasons",
    ],
    requiredInvariants: [
      "operator inspection is world and shard scoped",
      "ordinary players cannot access authoritative inspector payloads",
      "repairs remain version checked and audited",
      "browser inspector cannot arbitrarily mutate raw JSON",
    ],
    requiredEndpoints: [
      "GET /v1/operator/world/entities/:entityId",
      "GET /v1/operator/world/dashboard/:actorId",
    ],
    requiredSurfaces: ["/developer operator inspector"],
    browserRequired: false,
  }),
} as const satisfies Record<DashboardCapabilityName, DashboardCapability>;

export const DASHBOARD_CAPABILITY_NAMES = Object.keys(
  DASHBOARD_CAPABILITIES,
) as DashboardCapabilityName[];
