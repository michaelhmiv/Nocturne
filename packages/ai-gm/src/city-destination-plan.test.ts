import { describe, expect, it } from "vitest";
import { buildCityTravelPlan } from "./city-destination-plan.js";

const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const groceryId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("city travel plan", () => {
  it("writes a move step from an OSM destination id", () => {
    const plan = buildCityTravelPlan({
      command: "go to the nearest grocery store",
      actorId,
      destinationId: groceryId,
    });
    expect(plan.steps[0]).toMatchObject({
      kind: "move",
      intentPayload: {
        actionType: "move",
        destinationId: groceryId,
        locationId: groceryId,
      },
    });
    expect(plan.steps[0]?.referencedEntities).toEqual([
      { entityId: actorId, role: "actor" },
      { entityId: groceryId, role: "location" },
    ]);
  });
});
