import type { OutcomeGrade, StateOperation } from "@nocturne/contracts";

// ponytail: death loses only equipped/carried on person. Bank/property/vehicles persist.
export function buildCombatOperations(input: {
  outcome: OutcomeGrade;
  actorId: string;
  targetId: string;
  occurredAt: string;
}): StateOperation[] {
  const ops: StateOperation[] = [
    {
      type: "set_instance_state",
      instanceId: input.actorId,
      path: ["lastCombatAt"],
      value: input.occurredAt,
    },
  ];

  // Actor injury on bad outcomes
  if (input.outcome === "failure" || input.outcome === "failure_with_progress") {
    ops.push({
      type: "change_instance_condition",
      instanceId: input.actorId,
      delta: -5,
    });
  }
  if (input.outcome === "catastrophic_reversal") {
    ops.push(
      { type: "change_instance_condition", instanceId: input.actorId, delta: -40 },
      {
        type: "set_instance_state",
        instanceId: input.actorId,
        path: ["status"],
        value: "downed",
      },
      // flag death for store to strip carried items
      {
        type: "set_instance_state",
        instanceId: input.actorId,
        path: ["pendingDeath"],
        value: true,
      },
    );
  }

  // Target hurt on good outcomes
  if (
    input.outcome === "complete_success" ||
    input.outcome === "success_with_consequence" ||
    input.outcome === "partial_success"
  ) {
    ops.push({
      type: "change_instance_condition",
      instanceId: input.targetId,
      delta: input.outcome === "complete_success" ? -25 : -10,
    });
  }

  return ops;
}

/** XP gain 1-10 from outcome grade. */
export function xpFromOutcome(outcome: OutcomeGrade): number {
  switch (outcome) {
    case "complete_success":
      return 5;
    case "success_with_consequence":
      return 4;
    case "partial_success":
      return 3;
    case "failure_with_progress":
      return 2;
    case "failure":
      return 1;
    case "catastrophic_reversal":
      return 1;
    default:
      return 1;
  }
}
