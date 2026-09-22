import { describe, expect, it } from "vitest";
import { ensureCityStock } from "./ensure-city-stock.js";
import { stableEntityId } from "./resolve-city-destination.js";

describe("ensureCityStock", () => {
  it("materializes a wrench and possesses it without an NPC", async () => {
    const statements: string[] = [];
    const client = Object.assign(async (strings: TemplateStringsArray) => {
      statements.push(strings.join(" "));
      return [];
    });
    const placeId = stableEntityId("osm:node:14th-garage");
    const result = await ensureCityStock({
      database: { client } as never,
      scope: {
        worldId: "11111111-1111-4111-8111-111111111111",
        shardId: "22222222-2222-4222-8222-222222222222",
      },
      actorId: "44444444-4444-4444-8444-444444444444",
      place: {
        entityId: placeId,
        sourceKey: "osm:node:14th-garage",
        name: "14th Street Auto",
        family: "place.service.garage",
      },
      slot: { sku: "wrench", family: "item.tool", label: "wrench" },
    });
    expect(result.label).toBe("wrench");
    expect(statements.some((sql) => sql.includes("entity_definitions"))).toBe(true);
    expect(statements.some((sql) => sql.includes("possessed_by"))).toBe(true);
  });
});
