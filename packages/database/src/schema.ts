import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const game = pgSchema("game");
const system = pgSchema("system");

export const entityDefinitions = game.table(
  "entity_definitions",
  {
    definitionId: text("definition_id").primaryKey(),
    definitionType: text("definition_type").notNull(),
    name: text("name").notNull(),
    conceptSummary: text("concept_summary").notNull(),
    originSource: text("origin_source"),
    lifecycleStatus: text("lifecycle_status").notNull().default("provisional"),
    currentRevisionId: uuid("current_revision_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("entity_definitions_type_idx").on(table.definitionType),
    index("entity_definitions_status_idx").on(table.lifecycleStatus),
  ],
);

export const definitionRevisions = game.table(
  "definition_revisions",
  {
    revisionId: uuid("revision_id").primaryKey().defaultRandom(),
    definitionId: text("definition_id")
      .notNull()
      .references(() => entityDefinitions.definitionId, { onDelete: "cascade" }),
    schemaVersion: text("schema_version").notNull().default("content-v1"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    changeSummary: text("change_summary").notNull(),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("definition_revisions_definition_idx").on(table.definitionId)],
);

export const entityInstances = game.table(
  "entity_instances",
  {
    instanceId: uuid("instance_id").primaryKey().defaultRandom(),
    definitionId: text("definition_id")
      .notNull()
      .references(() => entityDefinitions.definitionId),
    ownerId: uuid("owner_id"),
    controllerId: uuid("controller_id"),
    locationId: uuid("location_id"),
    condition: integer("condition").notNull().default(100),
    state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
    createdEventId: uuid("created_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("entity_instances_definition_idx").on(table.definitionId),
    index("entity_instances_owner_idx").on(table.ownerId),
    index("entity_instances_location_idx").on(table.locationId),
  ],
);

export const playerCharacters = game.table(
  "player_characters",
  {
    userId: text("user_id").notNull(),
    characterInstanceId: uuid("character_instance_id")
      .notNull()
      .references(() => entityInstances.instanceId, { onDelete: "cascade" }),
    selected: boolean("selected").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.characterInstanceId] }),
    uniqueIndex("player_characters_character_uq").on(table.characterInstanceId),
    index("player_characters_user_idx").on(table.userId),
  ],
);

export const entityRelations = game.table(
  "entity_relations",
  {
    relationId: uuid("relation_id").primaryKey().defaultRandom(),
    sourceInstanceId: uuid("source_instance_id")
      .notNull()
      .references(() => entityInstances.instanceId, { onDelete: "cascade" }),
    targetInstanceId: uuid("target_instance_id")
      .notNull()
      .references(() => entityInstances.instanceId, { onDelete: "cascade" }),
    relationType: text("relation_type").notNull(),
    parameters: jsonb("parameters").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("entity_relations_unique_uq").on(
      table.sourceInstanceId,
      table.targetInstanceId,
      table.relationType,
    ),
    index("entity_relations_source_idx").on(table.sourceInstanceId, table.relationType),
    index("entity_relations_target_idx").on(table.targetInstanceId, table.relationType),
  ],
);

export const residenceOccupancies = game.table(
  "residence_occupancies",
  {
    residenceInstanceId: uuid("residence_instance_id")
      .primaryKey()
      .references(() => entityInstances.instanceId, { onDelete: "cascade" }),
    characterInstanceId: uuid("character_instance_id")
      .notNull()
      .references(() => entityInstances.instanceId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    status: text("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("residence_occupancies_character_uq").on(table.characterInstanceId),
    index("residence_occupancies_user_idx").on(table.userId),
  ],
);

export const generatedContentRequests = game.table(
  "generated_content_requests",
  {
    requestId: uuid("request_id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id").notNull(),
    userId: text("user_id"),
    residenceInstanceId: uuid("residence_instance_id").references(() => entityInstances.instanceId),
    definitionId: text("definition_id").references(() => entityDefinitions.definitionId),
    installedInstanceId: uuid("installed_instance_id").references(() => entityInstances.instanceId),
    rawConcept: text("raw_concept").notNull(),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
    draftPayload: jsonb("draft_payload").$type<Record<string, unknown>>(),
    validationResult: jsonb("validation_result").$type<Record<string, unknown>>(),
    installationResult: jsonb("installation_result").$type<Record<string, unknown>>(),
    validationStatus: text("validation_status").notNull().default("drafting"),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("generated_content_requests_creator_idx").on(table.creatorId),
    index("generated_content_requests_status_idx").on(table.validationStatus),
    index("generated_content_requests_user_idx").on(table.userId, table.createdAt),
    index("generated_content_requests_definition_idx").on(table.definitionId),
  ],
);

export const installationEvaluations = game.table(
  "installation_evaluations",
  {
    evaluationId: uuid("evaluation_id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => generatedContentRequests.requestId, { onDelete: "cascade" }),
    characterInstanceId: uuid("character_instance_id")
      .notNull()
      .references(() => entityInstances.instanceId),
    residenceInstanceId: uuid("residence_instance_id")
      .notNull()
      .references(() => entityInstances.instanceId),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("installation_evaluations_request_idx").on(table.requestId, table.createdAt)],
);

export const actionIntents = game.table(
  "action_intents",
  {
    intentId: uuid("intent_id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").notNull(),
    userId: text("user_id"),
    rawText: text("raw_text").notNull(),
    parsedIntent: jsonb("parsed_intent").$type<Record<string, unknown>>().notNull(),
    methodInstanceId: uuid("method_instance_id").references(() => entityInstances.instanceId),
    targetLocationId: uuid("target_location_id").references(() => entityInstances.instanceId),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("action_intents_actor_idx").on(table.actorId),
    uniqueIndex("action_intents_idempotency_uq").on(table.idempotencyKey),
  ],
);

export const eventLedger = game.table(
  "event_ledger",
  {
    eventId: uuid("event_id").primaryKey().defaultRandom(),
    idempotencyKey: text("idempotency_key").notNull(),
    worldTime: timestamp("world_time", { withTimezone: true }).notNull(),
    eventType: text("event_type").notNull(),
    involvedEntityIds: jsonb("involved_entity_ids").$type<string[]>().notNull().default([]),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    sourceIntentId: uuid("source_intent_id"),
    supersedesEventId: uuid("supersedes_event_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("event_ledger_idempotency_uq").on(table.idempotencyKey),
    index("event_ledger_world_time_idx").on(table.worldTime),
    index("event_ledger_type_idx").on(table.eventType),
  ],
);

export const resolutionResults = game.table(
  "resolution_results",
  {
    resolutionId: uuid("resolution_id").primaryKey().defaultRandom(),
    intentId: uuid("intent_id")
      .notNull()
      .references(() => actionIntents.intentId),
    eventId: uuid("event_id").references(() => eventLedger.eventId),
    outcomeGrade: text("outcome_grade").notNull(),
    calculationTrace: jsonb("calculation_trace").$type<string[]>().notNull(),
    proposedOperations: jsonb("proposed_operations")
      .$type<Array<Record<string, unknown>>>()
      .notNull(),
    narrativeConstraints: jsonb("narrative_constraints").$type<string[]>().notNull(),
    authoritativeSeed: text("authoritative_seed"),
    actorScore: integer("actor_score"),
    targetScore: integer("target_score"),
    narration: text("narration"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("resolution_results_intent_idx").on(table.intentId),
    uniqueIndex("resolution_results_event_uq").on(table.eventId),
  ],
);

export const informationAssets = game.table(
  "information_assets",
  {
    informationId: uuid("information_id").primaryKey().defaultRandom(),
    holderInstanceId: uuid("holder_instance_id")
      .notNull()
      .references(() => entityInstances.instanceId, { onDelete: "cascade" }),
    subjectInstanceId: uuid("subject_instance_id").references(() => entityInstances.instanceId),
    content: text("content").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
    truthStatus: text("truth_status").notNull(),
    sourceEventId: uuid("source_event_id")
      .notNull()
      .references(() => eventLedger.eventId),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("information_assets_holder_idx").on(table.holderInstanceId, table.createdAt),
    index("information_assets_subject_idx").on(table.subjectInstanceId),
  ],
);

export const aiRuns = system.table(
  "ai_runs",
  {
    runId: uuid("run_id").primaryKey().defaultRandom(),
    task: text("task").notNull(),
    authority: text("authority").notNull(),
    requestedModel: text("requested_model").notNull(),
    actualModel: text("actual_model"),
    promptPolicyVersion: text("prompt_policy_version").notNull(),
    providerRequestId: text("provider_request_id"),
    status: text("status").notNull(),
    inputHash: text("input_hash").notNull(),
    outputHash: text("output_hash"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("ai_runs_task_idx").on(table.task)],
);
