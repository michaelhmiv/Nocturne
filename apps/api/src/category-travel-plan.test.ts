import { describe, expect, it } from "vitest";
import { buildFastSingleStepPlan } from "@nocturne/ai-gm";
import { OSM_STARTER_POINT } from "@nocturne/rules-engine";
import type { RelevanceCompiledContext } from "@nocturne/contracts";
import { isCategoryTravelCommand } from "./category-travel.js";
import { resolveCityDestinationFromFeatures } from "./resolve-city-destination.js";

const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const homeId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
    const plan = buildFastSingleStepPlan({
      command,
      actorId,
      kind: "move",
      actionType: "move",
      selectedEntityIds: destination ? [destination.entityId] : [],
      selectedEntityRoles: destination ? { [destination.entityId]: "location" } : {},
      context: {
        entities: [
          { entityId: actorId, version: 1, definitionType: "character", locationId: homeId },
        ],
      } as unknown as RelevanceCompiledContext,
      destinationId: destination?.entityId,
    });
    expect(plan.steps[0]?.kind).toBe("move");
    expect(plan.steps[0]?.intentPayload).toMatchObject({
      destinationId: destination?.entityId,
      locationId: destination?.entityId,
    });
  });
});
