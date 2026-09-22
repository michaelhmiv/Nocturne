import { describe, expect, it } from "vitest";
import { canTraverse, interiorForSource } from "./interiors.js";

describe("building interiors", () => {
  it("gives every OSM place the same three-room graph", () => {
    const graph = interiorForSource("osm:node:14th-convenience");
    expect(graph.rooms.map((room) => room.roomKey)).toEqual([
      "osm:node:14th-convenience#street_door",
      "osm:node:14th-convenience#front",
      "osm:node:14th-convenience#counter",
    ]);
    expect(
      canTraverse(
        graph,
        "osm:node:14th-convenience#street_door",
        "osm:node:14th-convenience#front",
      ),
    ).toBe(true);
    expect(
      canTraverse(
        graph,
        "osm:node:14th-convenience#street_door",
        "osm:node:14th-convenience#counter",
      ),
    ).toBe(false);
  });
});
