import type { OutcomeGrade, StateOperation } from "@nocturne/contracts";

export function buildDetectionOperations(input: {
  outcome: OutcomeGrade;
  actorId: string;
  methodInstanceId: string;
  targetId: string;
  occurredAt: string;
}): StateOperation[] {
  const operations: StateOperation[] = [
    {
      type: "set_instance_state",
      instanceId: input.methodInstanceId,
      path: ["lastScanAt"],
      value: input.occurredAt,
    },
    { type: "consume_resource", instanceId: input.methodInstanceId, resource: "charge", amount: 1 },
  ];
  const information = {
    complete_success: {
      confidence: 0.95,
      content:
        "A concealed human contact is moving through the rear alley; direction, pace, and approximate position are reliable.",
    },
    success_with_consequence: {
      confidence: 0.8,
      content:
        "A human-sized contact is moving through the rear alley. The track is reliable, but active scanning may be detectable.",
    },
    partial_success: {
      confidence: 0.6,
      content:
        "Movement consistent with a person is present in the rear alley, but identity and exact position remain uncertain.",
    },
    failure_with_progress: {
      confidence: 0.35,
      content:
        "The system records an intermittent anomaly in the rear alley that may indicate movement.",
    },
    failure: null,
    catastrophic_reversal: null,
  }[input.outcome];
  if (information) {
    operations.push({
      type: "create_information_asset",
      holderId: input.actorId,
      subjectId: input.targetId,
      content: information.content,
      confidence: information.confidence,
      truthStatus: input.outcome === "failure_with_progress" ? "inference" : "observation",
    });
  }
  if (input.outcome === "catastrophic_reversal") {
    operations.push({
      type: "change_instance_condition",
      instanceId: input.methodInstanceId,
      delta: -5,
    });
  }
  return operations;
}
