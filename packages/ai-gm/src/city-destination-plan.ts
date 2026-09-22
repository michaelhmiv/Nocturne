import type { PersistentActionPlanProposal } from "@nocturne/contracts";

export function buildCityTravelPlan(input: {
  command: string;
  actorId: string;
  destinationId: string;
}): PersistentActionPlanProposal {
  return {
    originalCommand: input.command,
    exclusivePhysical: true,
    steps: [
      {
        order: 1,
        kind: "move",
        description: input.command,
        intentPayload: {
          rawText: input.command,
          actionType: "move",
          locationId: input.destinationId,
          destinationId: input.destinationId,
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
