import { describe, expect, it } from "vitest";
import { parseActionPlanResult } from "./action-plan-result";

const result = {
  planId: "plan-test",
  rawText: "Eat 5 bowls of oatmeal and then walk to the gas station",
  summary: "Eat what is available, then travel.",
  overallStatus: "partial_success",
  steps: [
    {
      stepId: "step-1",
      order: 1,
      rawText: "Eat 5 bowls of oatmeal",
      actionType: "consume",
      objective: "Eat five bowls of oatmeal",
      dependsOnPreviousSuccess: false,
      status: "completed",
      outcomeGrade: "partial_success",
      eventId: "10000000-0000-4000-8000-000000000001",
      consumption: {
        displayName: "Oatmeal packet",
        unitsConsumed: 1,
        remainingUnits: 0,
        materialized: false,
        conditions: [],
        risks: [],
      },
    },
    {
      stepId: "step-2",
      order: 2,
      rawText: "walk to the gas station",
      actionType: "move",
      objective: "Walk to the gas station",
      dependsOnPreviousSuccess: false,
      status: "completed",
      outcomeGrade: "complete_success",
      eventId: "10000000-0000-4000-8000-000000000002",
      travel: {
        to: "20000000-0000-4000-8000-000000000001",
        path: [],
        travelSeconds: 12,
        scheduled: true,
      },
    },
  ],
  narration: "You eat the only serving and set out for the gas station.",
  finalState: {
    locationId: "30000000-0000-4000-8000-000000000001",
    actorStatus: "active",
    pendingTravelTo: "20000000-0000-4000-8000-000000000001",
  },
  idempotentReplay: false,
};

describe("action plan result parser", () => {
  it("accepts structured multi-step action results", () => {
    expect(parseActionPlanResult(result)).toEqual(result);
  });

  it("rejects legacy single-action results", () => {
    expect(
      parseActionPlanResult({
        eventId: "10000000-0000-4000-8000-000000000001",
        outcomeGrade: "partial_success",
        narration: "Legacy action",
      }),
    ).toBeNull();
  });
});
