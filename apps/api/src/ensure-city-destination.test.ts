import { describe, expect, it } from "vitest";
import { ensureCityDestination } from "./ensure-city-destination.js";
import { stableEntityId } from "./resolve-city-destination.js";

describe("ensureCityDestination", () => {
  it("inserts the hashed OSM place before any plan can reference it", async () => {
    const statements: string[] = [];
    const client = Object.assign(async (strings: TemplateStringsArray) => {
      statements.push(strings.join(" "));
      return [];
    });
    const entityId = stableEntityId("osm:node:14th-convenience");
    await ensureCityDestination({
      database: { client } as never,
      scope: {
        worldId: "11111111-1111-4111-8111-111111111111",
        shardId: "22222222-2222-4222-8222-222222222222",
      },
      destination: {
        entityId,
        sourceKey: "osm:node:14th-convenience",
        name: "14th Street Convenience",
        family: "place.retail.food",
        distanceMeters: 80,
      },
      actorLocationId: "33333333-3333-4333-8333-333333333333",
    });
    expect(statements.some((sql) => sql.includes("entity_definitions"))).toBe(true);
    expect(statements.some((sql) => sql.includes("entity_instances"))).toBe(true);
    expect(statements.some((sql) => sql.includes("adjacent_to"))).toBe(true);
  });
});
