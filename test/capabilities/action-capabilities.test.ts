import { describe, expect, it } from "vitest";
import {
  ACTION_SKILL,
  ACTION_TYPES,
  defaultOutcomeBands,
  resolveContest,
  type ActionType,
} from "../../packages/rules-engine/src/index.js";
import { WorldActionKindSchema } from "../../packages/contracts/src/index.js";
import {
  ACTION_CAPABILITIES,
  ACTION_CAPABILITY_NAMES,
  ALL_OUTCOME_GRADES,
} from "./action-capabilities.js";

const expectedMargin = {
  complete_success: 6,
  success_with_consequence: 3,
  partial_success: 0,
  failure_with_progress: -3,
  failure: -6,
  catastrophic_reversal: -7,
} as const;

describe("action capability registry", () => {
  it("contains every action type exactly once", () => {
    expect([...ACTION_CAPABILITY_NAMES].sort()).toEqual([...ACTION_TYPES].sort());
    expect(new Set(ACTION_CAPABILITY_NAMES).size).toBe(ACTION_TYPES.length);
  });

  it.each(ACTION_TYPES)(
    "certifies %s with prompts, invariants, failures, logs, and browser coverage",
    (actionType) => {
      const capability = ACTION_CAPABILITIES[actionType];
      expect(WorldActionKindSchema.safeParse(capability.worldKind).success).toBe(true);
      expect(capability.canonicalPrompts.length).toBeGreaterThanOrEqual(2);
      expect(new Set(capability.canonicalPrompts).size).toBe(capability.canonicalPrompts.length);
      expect(capability.canonicalPrompts.every((prompt) => prompt.trim().length >= 8)).toBe(true);
      expect(capability.requiredDatabaseAssertions.length).toBeGreaterThan(0);
      expect(capability.negativeCases).toContain("provider_failure_before_commit");
      expect(capability.negativeCases).toContain("idempotent_replay");
      expect(capability.requiredLogEvents).toContain("request_received");
      expect(capability.requiredLogEvents).toContain("request_completed");
      expect(capability.requiredLogEvents).toContain("handler_started");
      expect(capability.requiredLogEvents).toContain("handler_completed");
      expect(capability.browserRequired).toBe(true);
    },
  );

  it.each(
    ACTION_TYPES.filter(
      (actionType): actionType is ActionType =>
        ACTION_CAPABILITIES[actionType].resolver === "contest",
    ),
  )("forces every contest outcome grade for %s deterministically", (actionType) => {
    expect(ACTION_CAPABILITIES[actionType].requiredOutcomeGrades).toEqual(ALL_OUTCOME_GRADES);
    expect(ACTION_SKILL[actionType]).toBeTruthy();
    for (const grade of ALL_OUTCOME_GRADES) {
      const result = resolveContest({
        actionType,
        actorScore: expectedMargin[grade],
        targetScore: 0,
        uncertaintyRange: 0,
        seed: `certification:${actionType}:${grade}`,
        outcomeBands: defaultOutcomeBands,
      });
      expect(result.outcomeGrade).toBe(grade);
    }
  });

  it("requires worker certification for every capability that schedules continuation", () => {
    for (const actionType of ACTION_TYPES) {
      const capability = ACTION_CAPABILITIES[actionType];
      if (["movement", "timed_work"].includes(capability.resolver)) {
        expect(capability.workerRequired, actionType).toBe(true);
      }
    }
  });
});
