import { describe, expect, it } from "vitest";
import { frameFromUtterance } from "@nocturne/contracts";
import { OSM_STARTER_POINT } from "@nocturne/rules-engine";
import { buildCityTravelPlan } from "@nocturne/ai-gm";
import { resolveCityDestinationFromFeatures } from "./resolve-city-destination.js";

const actorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const SURFACE: Array<{ command: string; family: string; sourceKey: string; primitive: string }> = [
  { command: "go to the nearest grocery store", family: "place.retail.food", sourceKey: "osm:node:14th-convenience", primitive: "travel" },
  { command: "walk to the closest bodega", family: "place.retail.food", sourceKey: "osm:node:14th-convenience", primitive: "travel" },
  { command: "go to the nearest pharmacy", family: "place.retail.pharmacy", sourceKey: "osm:node:14th-pharmacy", primitive: "travel" },
  { command: "go to the nearest laundromat", family: "place.service.laundry", sourceKey: "osm:node:union-laundry", primitive: "travel" },
  { command: "go to the nearest restaurant", family: "place.service.restaurant", sourceKey: "osm:node:14th-diner", primitive: "travel" },
  { command: "go to the nearest bar", family: "place.service.bar", sourceKey: "osm:node:old-town-bar", primitive: "travel" },
  { command: "go to the nearest bank", family: "place.service.bank", sourceKey: "osm:node:chase-union", primitive: "travel" },
  { command: "go to the nearest liquor store", family: "place.retail.liquor", sourceKey: "osm:node:union-liquor", primitive: "travel" },
  { command: "go to the nearest hardware store", family: "place.retail.hardware", sourceKey: "osm:node:14th-hardware", primitive: "travel" },
  { command: "drive to the gas station", family: "place.service.fuel", sourceKey: "osm:node:midtown-fuel", primitive: "travel" },
  { command: "drive to the garage", family: "place.service.garage", sourceKey: "osm:node:14th-garage", primitive: "travel" },
  { command: "go to the hospital", family: "place.service.hospital", sourceKey: "osm:node:beth-israel", primitive: "travel" },
  { command: "walk to the precinct", family: "place.civic.precinct", sourceKey: "osm:node:9th-precinct", primitive: "travel" },
  { command: "go to the firehouse", family: "place.civic.firehouse", sourceKey: "osm:node:engine-5", primitive: "travel" },
  { command: "go to the nearest subway", family: "place.transit", sourceKey: "osm:node:union-subway", primitive: "travel" },
  { command: "go to the post office", family: "place.civic.post", sourceKey: "osm:node:union-post", primitive: "travel" },
];

describe("starter city surface", () => {
  it.each(SURFACE)("$command → $family → $sourceKey", ({ command, family, sourceKey, primitive }) => {
    expect(frameFromUtterance(command)).toMatchObject({ primitive, category: family });
    const destination = resolveCityDestinationFromFeatures({
      command,
      lon: OSM_STARTER_POINT.lon,
      lat: OSM_STARTER_POINT.lat,
    });
    expect(destination).toMatchObject({ family, sourceKey });
    const plan = buildCityTravelPlan({
      command,
      actorId,
      destinationId: destination!.entityId,
    });
    expect(plan.steps[0]?.intentPayload).toMatchObject({ destinationId: destination?.entityId });
  });

  it("keeps occupy and operate off the travel resolver", () => {
    expect(frameFromUtterance("get in the parked car")).toMatchObject({
      primitive: "occupy",
      category: "vehicle.automobile",
    });
    expect(frameFromUtterance("shoot the pistol")).toMatchObject({
      primitive: "operate",
      category: "item.weapon",
    });
    expect(
      resolveCityDestinationFromFeatures({
        command: "get in the parked car",
        lon: OSM_STARTER_POINT.lon,
        lat: OSM_STARTER_POINT.lat,
      }),
    ).toBeNull();
  });
});
