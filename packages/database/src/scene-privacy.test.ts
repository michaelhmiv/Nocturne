import { describe, expect, it } from "vitest";
import { playerVisibleLocation } from "./scene-privacy.js";

const place = "11111111-1111-4111-8111-111111111111";
describe("player-scoped entity location", () => {
  it("never turns previous knowledge into live tracking", () => {
    expect(playerVisibleLocation({ presence: "known_elsewhere",
      locationId: place, locationName: "Undisclosed apartment" }))
      .toEqual({ locationId: null, locationName: null });
  });
  it("retains only present entity locations", () => {
    expect(playerVisibleLocation({ presence: "nearby",
      locationId: place, locationName: "Public plaza" }))
      .toEqual({ locationId: place, locationName: "Public plaza" });
  });
});
