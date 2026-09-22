import { describe, expect, it } from "vitest";
import { buildCityTravelPlan } from "@nocturne/ai-gm";
import { OSM_STARTER_POINT } from "@nocturne/rules-engine";
import { isCategoryTravelCommand } from "./category-travel.js";
import { resolveCityDestinationFromFeatures } from "./resolve-city-destination.js";

const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("category travel submit compile", () => {
  it("compiles nearest grocery to a move plan against the OSM convenience shop", () => {
    const command = "go to the nearest grocery store";
    expect(isCategoryTravelCommand(command)).toBe(true);
    const destination = resolveCityDestinationFromFeatures({
      command,
      lon: OSM_STARTER_POINT.lon,
      lat: OSM_STARTER_POINT.lat,
    });
    expect(destination?.sourceKey).toBe("osm:node:14th-convenience");
    const plan = buildCityTravelPlan({
      command,
      actorId,
      destinationId: destination!.entityId,
    });
    expect(plan.steps[0]?.kind).toBe("move");
    expect(plan.steps[0]?.intentPayload).toMatchObject({
      destinationId: destination?.entityId,
      locationId: destination?.entityId,
    });
  });
});
