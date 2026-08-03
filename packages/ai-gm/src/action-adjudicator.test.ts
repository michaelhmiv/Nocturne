import { describe, expect, it } from "vitest";
import { assertNarrationConsistentWithCommittedEvent } from "./action-adjudicator.js";

const committedConsumption = {
  eventId: "10000000-0000-4000-8000-000000000001",
  intentId: "10000000-0000-4000-8000-000000000002",
  resolutionId: "10000000-0000-4000-8000-000000000003",
  rawText: "Eat 5 bowls of oatmeal and then walk to the gas station",
  outcomeGrade: "partial_success",
  margin: 1,
  calculationTrace: [],
  informationGained: [],
  costs: [{ resource: "quantity", amount: 1 }],
  consumption: {
    sourceType: "entity" as const,
    sourceId: "20000000-0000-4000-8000-000000000001",
    displayName: "Oatmeal packet",
    unitsConsumed: 1,
    remainingUnits: 0,
    materialized: false,
    resourceDeltas: [{ resource: "nutrition", delta: 2, rationale: "One modest serving." }],
    conditions: [],
    risks: [],
  },
  createdAt: "2026-07-30T22:00:00.000Z",
  factsToPreserve: [
    "outcome:partial_success",
    "requested_units:5",
    "consumed_units:1",
    "remaining_units:0",
  ],
  hiddenFactsToExclude: [],
} satisfies Parameters<typeof assertNarrationConsistentWithCommittedEvent>[1];

describe("committed-event narration guard", () => {
  it("accepts prose that stays within committed consumption facts", () => {
    expect(() =>
      assertNarrationConsistentWithCommittedEvent(
        "You prepare and eat the only oatmeal packet available.",
        committedConsumption,
      ),
    ).not.toThrow();
  });

  it("rejects invented quantity, collapse, travel, and mission state", () => {
    expect(() =>
      assertNarrationConsistentWithCommittedEvent(
        "You eat five bowls, collapse halfway to the gas station, and the mission fails.",
        committedConsumption,
      ),
    ).toThrow(/unsupported incapacitation|travel progress|mission state|claimed 5 consumed units/);
  });

  it("permits a severe consequence only when it was committed", () => {
    const poisoned = {
      ...committedConsumption,
      consumption: {
        ...committedConsumption.consumption,
        conditions: [
          {
            name: "Unconscious",
            key: "unconscious",
            intensity: -8,
            durationSeconds: 60,
            rationale: "The committed toxin effect causes unconsciousness.",
          },
        ],
      },
    } satisfies Parameters<typeof assertNarrationConsistentWithCommittedEvent>[1];

    expect(() =>
      assertNarrationConsistentWithCommittedEvent(
        "The toxin takes hold and you fall unconscious.",
        poisoned,
      ),
    ).not.toThrow();
  });
});