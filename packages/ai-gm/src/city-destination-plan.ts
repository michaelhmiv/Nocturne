import type { PersistentActionPlanProposal } from "@nocturne/contracts";

export function buildCityTravelPlan(input: {
  command: string;
  actorId: string;
  destinationId: string;
  destinationName?: string;
}): PersistentActionPlanProposal {
  const destinationLabel = input.destinationName || input.destinationId;
  return {
    originalCommand: input.command,
    exclusivePhysical: true,
    steps: [
      {
        order: 1,
        kind: "move",
        description: input.destinationName ? `Walk to ${input.destinationName}` : input.command,
        intentPayload: {
          rawText: input.command,
          actionType: "move",
          locationId: input.destinationId,
          destinationId: input.destinationId,
          destinationName: destinationLabel,
        },
        referencedEntities: [
          { entityId: input.actorId, role: "actor" },
          { entityId: input.destinationId, role: "location" },
        ],
      },
    ],
    dependencies: [],
  };
}
