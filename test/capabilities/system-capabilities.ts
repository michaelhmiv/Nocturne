import type { GameplayTelemetryEventName } from "../../packages/contracts/src/index.js";

export type SystemCapabilityName =
  | "authentication"
  | "selected_character"
  | "world_scope"
  | "shard_scope"
  | "context_compilation"
  | "reference_resolution"
  | "aliases_and_pronouns"
  | "persistent_identity"
  | "search_discovery"
  | "bounded_materialization"
  | "location_materialization"
  | "ownership"
  | "possession"
  | "control"
  | "custody"
  | "containment"
  | "residence"
  | "following"
  | "travel_cohorts"
  | "persistent_plans"
  | "plan_supersession"
  | "scheduled_work"
  | "worker_leases"
  | "lazy_simulation"
  | "event_ledger"
  | "mutation_receipts"
  | "resources"
  | "conditions"
  | "inventory"
  | "legal_heat"
  | "jail"
  | "faction_standing"
  | "communications"
  | "commerce"
  | "crafting"
  | "healing"
  | "work_paydays"
  | "narration"
  | "provider_configuration"
  | "operator_repair"
  | "player_safe_scene"
  | "legacy_route_rejection";

export interface SystemCapability {
  requiredScenarios: readonly [string, ...string[]];
  requiredInvariants: readonly [string, ...string[]];
  requiredLogEvents: readonly GameplayTelemetryEventName[];
  browserRequired: boolean;
  workerRequired: boolean;
}

const REQUEST_LOGS = ["request_received", "request_completed"] as const satisfies readonly GameplayTelemetryEventName[];
const ACTION_LOGS = [
  "request_received",
  "scope_resolved",
  "context_compilation_completed",
  "reference_resolution_completed",
  "plan_created",
  "handler_completed",
  "event_committed",
  "request_completed",
] as const satisfies readonly GameplayTelemetryEventName[];

function capability(
  requiredScenarios: readonly [string, ...string[]],
  requiredInvariants: readonly [string, ...string[]],
  options: { logs?: readonly GameplayTelemetryEventName[]; browser?: boolean; worker?: boolean } = {},
): SystemCapability {
  return {
    requiredScenarios,
    requiredInvariants,
    requiredLogEvents: options.logs || ACTION_LOGS,
    browserRequired: options.browser ?? true,
    workerRequired: options.worker ?? false,
  };
}

export const SYSTEM_CAPABILITIES = {
  authentication: capability(["guest", "session", "agent_token", "unauthorized"], ["no unauthenticated mutation"], { logs: REQUEST_LOGS }),
  selected_character: capability(["select", "missing", "wrong_actor"], ["one selected character per membership"]),
  world_scope: capability(["same_world", "cross_world_rejected"], ["all authoritative rows have world scope"]),
  shard_scope: capability(["same_shard", "cross_shard_rejected"], ["live mutations remain shard scoped"]),
  context_compilation: capability(["mandatory_actor", "explicit_reference", "token_budget"], ["hidden and player-known facts remain separated"]),
  reference_resolution: capability(["resolved", "ambiguous", "not_found", "stale"], ["only supplied candidates can resolve"]),
  aliases_and_pronouns: capability(["private_alias", "former_alias", "pronoun", "two_entity_ambiguity"], ["private aliases remain viewpoint scoped"]),
  persistent_identity: capability(["rename", "death", "merge_redirect"], ["identity survives names and lifecycle changes"]),
  search_discovery: capability(["existing_entity", "materialized_entity", "partial_evidence", "nothing_found"], ["search never grants ownership automatically"]),
  bounded_materialization: capability(["capacity_available", "capacity_depleted", "concurrent_duplicate"], ["source capacity cannot become negative"]),
  location_materialization: capability(["reuse_existing", "create_child", "deduplicate"], ["semantic duplicates converge"]),
  ownership: capability(["grant", "transfer", "revoke"], ["exclusive ownership is not duplicated"]),
  possession: capability(["pick_up", "drop", "transfer"], ["effective location follows possession chain"]),
  control: capability(["grant", "revoke", "unauthorized_action"], ["control is distinct from ownership"]),
  custody: capability(["arrest", "release", "transfer_custody"], ["exclusive custody remains coherent"]),
  containment: capability(["put_inside", "remove", "cycle_rejected"], ["containment graph is acyclic"]),
  residence: capability(["rent", "occupy", "leave_entity_home"], ["residence does not follow the player automatically"]),
  following: capability(["establish", "travel", "stop_following"], ["following is distinct from ownership and control"]),
  travel_cohorts: capability(["leader", "passenger", "carried", "follower"], ["one leader and unique membership per cohort"], { worker: true }),
  persistent_plans: capability(["single_step", "multi_step", "waiting", "resume"], ["completed plans have no required nonterminal steps"], { worker: true }),
  plan_supersession: capability(["reject_conflict", "supersede", "cancel"], ["one active exclusive physical plan per actor"]),
  scheduled_work: capability(["travel", "craft", "jail_release", "duplicate_delivery"], ["one result event per schedule"], { worker: true }),
  worker_leases: capability(["claim", "stale_recovery", "restart", "retry"], ["one active lease owner per work item"], { browser: false, worker: true }),
  lazy_simulation: capability(["no_change", "bounded_change", "stale", "terminal_entity"], ["elapsed interval applies at most once"], { worker: true }),
  event_ledger: capability(["append", "read", "compensate"], ["ledger rows are append only"]),
  mutation_receipts: capability(["commit", "replay", "conflict"], ["each authoritative mutation has one receipt"]),
  resources: capability(["gain", "spend", "insufficient"], ["resource balances respect configured bounds"]),
  conditions: capability(["apply", "expire", "stack", "terminal"], ["condition changes are event backed"]),
  inventory: capability(["acquire", "drop", "sell", "death_strip"], ["inventory agrees with possession relations"]),
  legal_heat: capability(["crime", "warrant", "no_duplicate_heat"], ["heat is applied once per committed event"]),
  jail: capability(["enter", "scheduled_release", "duplicate_release"], ["jail status and release schedule agree"], { worker: true }),
  faction_standing: capability(["gain", "loss", "bounded_update"], ["standing changes are traceable to events"]),
  communications: capability(["message", "call", "intercepted", "not_intercepted"], ["message body and interception result are recorded once"]),
  commerce: capability(["list", "buy", "sell", "cancel"], ["money and ownership transfer atomically"]),
  crafting: capability(["start", "reserve", "complete", "restart"], ["materials and created items cannot duplicate"], { worker: true }),
  healing: capability(["success", "partial", "supply_missing"], ["healing cannot revive terminal entities through ordinary actions"]),
  work_paydays: capability(["complete", "poor_outcome", "duplicate"], ["payday applies once"]),
  narration: capability(["committed_facts", "provider_failure", "hidden_fact_exclusion"], ["narration cannot alter authoritative state"]),
  provider_configuration: capability(["deepseek", "openai_compatible", "invalid_model", "missing_key"], ["player input cannot select provider or model"], { logs: ["provider_call_started", "provider_call_completed", "provider_call_failed"], browser: false }),
  operator_repair: capability(["inspect", "versioned_repair", "compensating_event"], ["operator repair is audited and version checked"], { browser: false }),
  player_safe_scene: capability(["nearby", "known_elsewhere", "waiting_plan"], ["hidden state and raw mechanics are omitted"]),
  legacy_route_rejection: capability(["old_action_endpoint", "old_worker_route"], ["legacy gameplay writes return 410 and create no rows"]),
} as const satisfies Record<SystemCapabilityName, SystemCapability>;

export const SYSTEM_CAPABILITY_NAMES = Object.keys(SYSTEM_CAPABILITIES) as SystemCapabilityName[];
