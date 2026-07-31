import type {
  GameplayTelemetryEventName,
  WorldActionKind,
} from "../../packages/contracts/src/index.js";
import type { ActionType, SkillName } from "../../packages/rules-engine/src/index.js";

export const ALL_OUTCOME_GRADES = [
  "complete_success",
  "success_with_consequence",
  "partial_success",
  "failure_with_progress",
  "failure",
  "catastrophic_reversal",
] as const;

export type CertifiedOutcomeGrade = (typeof ALL_OUTCOME_GRADES)[number];
export type ActionResolverFamily =
  | "contest"
  | "movement"
  | "consumption"
  | "dialogue"
  | "commerce"
  | "state_transition"
  | "timed_work";

export interface ActionCapability {
  worldKind: WorldActionKind;
  resolver: ActionResolverFamily;
  skill?: SkillName;
  canonicalPrompts: readonly [string, string, ...string[]];
  requiredOutcomeGrades: readonly CertifiedOutcomeGrade[];
  requiredLogEvents: readonly GameplayTelemetryEventName[];
  requiredDatabaseAssertions: readonly [string, ...string[]];
  negativeCases: readonly [string, ...string[]];
  browserRequired: true;
  workerRequired: boolean;
}

const STANDARD_LOGS = [
  "request_received",
  "scope_resolved",
  "context_compilation_started",
  "context_compilation_completed",
  "reference_resolution_started",
  "reference_resolution_completed",
  "provider_call_started",
  "provider_call_completed",
  "plan_created",
  "step_claimed",
  "handler_started",
  "handler_completed",
  "event_committed",
  "step_completed",
  "request_completed",
] as const satisfies readonly GameplayTelemetryEventName[];

const STANDARD_NEGATIVE_CASES = [
  "provider_failure_before_commit",
  "unauthorized_actor",
  "idempotent_replay",
  "stale_entity_reference",
] as const;

function contest(
  input: Omit<ActionCapability, "resolver" | "requiredOutcomeGrades" | "browserRequired">,
): ActionCapability {
  return {
    ...input,
    resolver: "contest",
    requiredOutcomeGrades: ALL_OUTCOME_GRADES,
    browserRequired: true,
  };
}

function deterministic(
  resolver: Exclude<ActionResolverFamily, "contest">,
  input: Omit<ActionCapability, "resolver" | "requiredOutcomeGrades" | "browserRequired">,
): ActionCapability {
  return {
    ...input,
    resolver,
    requiredOutcomeGrades: ["complete_success", "partial_success", "failure"],
    browserRequired: true,
  };
}

export const ACTION_CAPABILITIES = {
  detect: contest({
    worldKind: "search",
    skill: "investigation",
    canonicalPrompts: [
      "I scan the room for hidden threats.",
      "Check the alley for anyone watching us.",
    ],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "one action request",
      "one event",
      "knowledge changes only when discovered",
    ],
    negativeCases: [...STANDARD_NEGATIVE_CASES, "hidden_fact_leak"],
    workerRequired: false,
  }),
  move: deterministic("movement", {
    worldKind: "move",
    skill: "athletics",
    canonicalPrompts: ["I walk into the street.", "Head toward the alley."],
    requiredLogEvents: [...STANDARD_LOGS, "schedule_created", "step_waiting", "request_waiting"],
    requiredDatabaseAssertions: [
      "one movement plan",
      "one schedule for nontrivial travel",
      "authoritative location changes on arrival",
    ],
    negativeCases: [
      ...STANDARD_NEGATIVE_CASES,
      "no_route",
      "destination_missing",
      "duplicate_arrival",
    ],
    workerRequired: true,
  }),
  search: contest({
    worldKind: "search",
    skill: "investigation",
    canonicalPrompts: [
      "I search the alley for a dog.",
      "Look through the room for useful evidence.",
    ],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "search request is recorded",
      "materialization occurs only on an authorized successful branch",
      "observation does not grant ownership",
    ],
    negativeCases: [
      ...STANDARD_NEGATIVE_CASES,
      "depleted_materialization_source",
      "request_is_not_evidence",
    ],
    workerRequired: false,
  }),
  talk: deterministic("dialogue", {
    worldKind: "dialogue",
    skill: "persuasion",
    canonicalPrompts: [
      "I ask the man what happened.",
      "Talk to the bartender about the neighborhood.",
    ],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "conversation event is recorded",
      "speaker identity remains grounded",
      "uncommitted facts are not narrated",
    ],
    negativeCases: [...STANDARD_NEGATIVE_CASES, "speaker_not_present", "ambiguous_speaker"],
    workerRequired: false,
  }),
  attack: contest({
    worldKind: "combat",
    skill: "combat",
    canonicalPrompts: ["I punch the guard.", "Rush the attacker and strike him."],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "combat event is recorded",
      "damage and conditions match the committed outcome",
      "terminal lifecycle state cannot be overwritten",
    ],
    negativeCases: [
      ...STANDARD_NEGATIVE_CASES,
      "target_missing",
      "target_already_dead",
      "duplicate_damage",
    ],
    workerRequired: false,
  }),
  steal: contest({
    worldKind: "transfer",
    skill: "stealth",
    canonicalPrompts: [
      "I steal the wallet from the table.",
      "Slip the keys into my pocket without being seen.",
    ],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "transfer event is recorded",
      "possession changes only on a committed success",
      "heat is applied once",
    ],
    negativeCases: [
      ...STANDARD_NEGATIVE_CASES,
      "item_not_present",
      "item_already_possessed",
      "duplicate_heat",
    ],
    workerRequired: false,
  }),
  sneak: contest({
    worldKind: "interact",
    skill: "stealth",
    canonicalPrompts: ["I sneak past the guard.", "Move quietly through the hallway."],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "stealth event is recorded",
      "detection state matches outcome",
      "location does not change without movement authority",
    ],
    negativeCases: [...STANDARD_NEGATIVE_CASES, "blocked_route", "observer_missing"],
    workerRequired: false,
  }),
  lockpick: contest({
    worldKind: "interact",
    skill: "mechanics",
    canonicalPrompts: ["I pick the door lock.", "Use my tools to open the locked cabinet."],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "lock interaction event is recorded",
      "access state changes only on success",
      "tool state remains consistent",
    ],
    negativeCases: [...STANDARD_NEGATIVE_CASES, "lock_missing", "tool_missing", "already_unlocked"],
    workerRequired: false,
  }),
  hack: contest({
    worldKind: "interact",
    skill: "hacking",
    canonicalPrompts: ["I hack the security terminal.", "Try to bypass the camera network."],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "hack event is recorded",
      "access or information changes match outcome",
      "unrelated systems are untouched",
    ],
    negativeCases: [
      ...STANDARD_NEGATIVE_CASES,
      "device_missing",
      "access_unavailable",
      "countermeasure_trigger",
    ],
    workerRequired: false,
  }),
  heal: contest({
    worldKind: "interact",
    skill: "medicine",
    canonicalPrompts: ["I bandage her wound.", "Treat my injury with the first-aid kit."],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "healing event is recorded",
      "conditions improve only as committed",
      "consumed medical supplies are deducted once",
    ],
    negativeCases: [
      ...STANDARD_NEGATIVE_CASES,
      "patient_missing",
      "supply_missing",
      "terminal_patient",
    ],
    workerRequired: false,
  }),
  consume: deterministic("consumption", {
    worldKind: "consume",
    canonicalPrompts: ["I eat a sandwich from the kitchen.", "Drink a glass of water."],
    requiredLogEvents: [...STANDARD_LOGS, "resolution_committed"],
    requiredDatabaseAssertions: [
      "consumption resolution is recorded",
      "selected source and units are logged",
      "resource and condition effects equal committed mechanics",
    ],
    negativeCases: [
      ...STANDARD_NEGATIVE_CASES,
      "nothing_available",
      "non_consumable",
      "spoiled_substance",
      "partial_quantity",
    ],
    workerRequired: false,
  }),
  craft: deterministic("timed_work", {
    worldKind: "interact",
    skill: "engineering",
    canonicalPrompts: [
      "I craft a simple lockpick from the available materials.",
      "Build a basic shelf in the workshop.",
    ],
    requiredLogEvents: [...STANDARD_LOGS, "schedule_created", "step_waiting", "request_waiting"],
    requiredDatabaseAssertions: [
      "craft plan is recorded",
      "materials are reserved once",
      "completed item is created by authoritative scheduled work",
    ],
    negativeCases: [
      ...STANDARD_NEGATIVE_CASES,
      "materials_missing",
      "duplicate_completion",
      "worker_restart",
    ],
    workerRequired: true,
  }),
  drive: deterministic("movement", {
    worldKind: "move",
    skill: "driving",
    canonicalPrompts: ["I drive to the warehouse.", "Take the car into the city."],
    requiredLogEvents: [...STANDARD_LOGS, "schedule_created", "step_waiting", "request_waiting"],
    requiredDatabaseAssertions: [
      "vehicle travel plan is recorded",
      "vehicle and passengers move as one cohort",
      "arrival commits once",
    ],
    negativeCases: [
      ...STANDARD_NEGATIVE_CASES,
      "vehicle_missing",
      "route_missing",
      "duplicate_arrival",
    ],
    workerRequired: true,
  }),
  bribe: contest({
    worldKind: "relationship",
    skill: "persuasion",
    canonicalPrompts: [
      "I offer the guard money to look the other way.",
      "Bribe the clerk for access.",
    ],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "bribe event is recorded",
      "currency deduction and disposition change are atomic",
      "failed bribes do not silently grant access",
    ],
    negativeCases: [
      ...STANDARD_NEGATIVE_CASES,
      "insufficient_funds",
      "recipient_missing",
      "duplicate_payment",
    ],
    workerRequired: false,
  }),
  persuade: contest({
    worldKind: "relationship",
    skill: "persuasion",
    canonicalPrompts: ["I persuade her to help us.", "Convince the owner to let me inside."],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "persuasion event is recorded",
      "relationship or access changes match outcome",
      "private knowledge remains scoped",
    ],
    negativeCases: [...STANDARD_NEGATIVE_CASES, "recipient_missing", "unreachable_request"],
    workerRequired: false,
  }),
  threaten: contest({
    worldKind: "relationship",
    skill: "persuasion",
    canonicalPrompts: [
      "I threaten the guard to make him leave.",
      "Warn the thief that I will expose him.",
    ],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "threat event is recorded",
      "fear hostility and heat changes are committed once",
      "narration preserves the actual outcome",
    ],
    negativeCases: [...STANDARD_NEGATIVE_CASES, "target_missing", "duplicate_hostility"],
    workerRequired: false,
  }),
  disguise: contest({
    worldKind: "interact",
    skill: "stealth",
    canonicalPrompts: [
      "I disguise myself as a maintenance worker.",
      "Change my appearance to blend into the crowd.",
    ],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "disguise event is recorded",
      "temporary condition has bounded duration",
      "identity is not replaced",
    ],
    negativeCases: [...STANDARD_NEGATIVE_CASES, "materials_missing", "invalid_identity_rewrite"],
    workerRequired: false,
  }),
  forge: contest({
    worldKind: "interact",
    skill: "electronics",
    canonicalPrompts: ["I forge a visitor badge.", "Create a convincing copy of the access card."],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "forgery event is recorded",
      "created artifact has provenance",
      "authentic records are not modified",
    ],
    negativeCases: [...STANDARD_NEGATIVE_CASES, "materials_missing", "unsupported_document"],
    workerRequired: false,
  }),
  plant: contest({
    worldKind: "interact",
    skill: "stealth",
    canonicalPrompts: ["I plant the tracker under the car.", "Hide the evidence in his bag."],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "plant event is recorded",
      "containment or possession changes once",
      "detection consequences match outcome",
    ],
    negativeCases: [
      ...STANDARD_NEGATIVE_CASES,
      "item_missing",
      "target_missing",
      "duplicate_relation",
    ],
    workerRequired: false,
  }),
  observe: contest({
    worldKind: "search",
    skill: "investigation",
    canonicalPrompts: [
      "I observe the street from the window.",
      "Watch the guard's routine carefully.",
    ],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "observation event is recorded",
      "knowledge is viewpoint-scoped",
      "hidden mechanics are not exposed",
    ],
    negativeCases: [...STANDARD_NEGATIVE_CASES, "target_not_visible", "hidden_fact_leak"],
    workerRequired: false,
  }),
  arrest: contest({
    worldKind: "combat",
    skill: "combat",
    canonicalPrompts: ["I arrest the suspect.", "Restrain the attacker and take him into custody."],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "arrest event is recorded",
      "custody and restraint relations are authoritative",
      "release scheduling is idempotent",
    ],
    negativeCases: [
      ...STANDARD_NEGATIVE_CASES,
      "target_missing",
      "authority_missing",
      "duplicate_custody",
    ],
    workerRequired: true,
  }),
  buy: deterministic("commerce", {
    worldKind: "transfer",
    skill: "persuasion",
    canonicalPrompts: ["I buy the toolbox from the listing.", "Purchase the food from the vendor."],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "purchase event is recorded",
      "currency and ownership transfer atomically",
      "listing cannot be bought twice",
    ],
    negativeCases: [
      ...STANDARD_NEGATIVE_CASES,
      "insufficient_funds",
      "listing_unavailable",
      "duplicate_purchase",
    ],
    workerRequired: false,
  }),
  sell: deterministic("commerce", {
    worldKind: "transfer",
    skill: "persuasion",
    canonicalPrompts: ["I sell the spare radio.", "List the toolbox for sale."],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "sale event is recorded",
      "seller owns the item",
      "ownership and payment remain consistent",
    ],
    negativeCases: [
      ...STANDARD_NEGATIVE_CASES,
      "item_not_owned",
      "duplicate_sale",
      "listing_conflict",
    ],
    workerRequired: false,
  }),
  hide: contest({
    worldKind: "interact",
    skill: "stealth",
    canonicalPrompts: ["I hide behind the crates.", "Find a concealed position in the room."],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "hide event is recorded",
      "concealment state matches outcome",
      "physical location remains valid",
    ],
    negativeCases: [...STANDARD_NEGATIVE_CASES, "no_cover", "observer_already_alerted"],
    workerRequired: false,
  }),
  work: deterministic("timed_work", {
    worldKind: "interact",
    skill: "athletics",
    canonicalPrompts: ["I work the warehouse shift.", "Take the available delivery job."],
    requiredLogEvents: STANDARD_LOGS,
    requiredDatabaseAssertions: [
      "work event is recorded",
      "payday is applied once",
      "cash and skill progress match the committed outcome",
    ],
    negativeCases: [...STANDARD_NEGATIVE_CASES, "job_unavailable", "duplicate_payday"],
    workerRequired: true,
  }),
} as const satisfies Record<ActionType, ActionCapability>;

export const ACTION_CAPABILITY_NAMES = Object.keys(ACTION_CAPABILITIES) as ActionType[];
