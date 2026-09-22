import { describe, expect, it } from "vitest";
import {
  REQUIRED_SANDBOX_DOMAINS,
  SANDBOX_NOUN_LEXICON,
  SandboxDomainSchema,
  frameFromUtterance,
  isInventedSuccess,
  lookupNoun,
  mayClarify,
} from "./sandbox-systems.js";

describe("sandbox constitution", () => {
  it("names every GTA-style domain so none can be skipped off-page", () => {
    expect(REQUIRED_SANDBOX_DOMAINS).toEqual([
      "geography",
      "mobility",
      "vehicles",
      "commerce",
      "inventory",
      "weapons_combat",
      "body",
      "property",
      "population",
      "economy",
      "legal",
      "emergency",
      "information",
      "communication",
      "time_schedule",
      "multiplayer",
    ]);
    expect(new Set(SandboxDomainSchema.options).size).toBe(16);
  });

  it("maps city nouns to categories instead of per-store handlers", () => {
    expect(lookupNoun("go to the nearest grocery store")?.family).toBe("place.retail.food");
    expect(lookupNoun("closest bodega")?.family).toBe("place.retail.food");
    expect(lookupNoun("find a supermarket")?.family).toBe("place.retail.food");
    expect(lookupNoun("drive to the gas station")?.family).toBe("place.service.fuel");
    expect(lookupNoun("get in the parked car")?.family).toBe("vehicle.automobile");
    expect(lookupNoun("shoot the pistol")?.family).toBe("item.weapon");
    expect(lookupNoun("go to the hospital")?.family).toBe("place.service.hospital");
    expect(lookupNoun("walk to the precinct")?.family).toBe("place.civic.precinct");
    expect(lookupNoun("go to the nearest pharmacy")?.family).toBe("place.retail.pharmacy");
    expect(lookupNoun("go to the nearest restaurant")?.family).toBe("place.service.restaurant");
    expect(lookupNoun("go to the gun shop")?.family).toBe("place.retail.weapons");
  });

  it("turns nearest-grocery language into travel + food retail + nearest", () => {
    const frame = frameFromUtterance("go to the nearest grocery store");
    expect(frame).toMatchObject({
      primitive: "travel",
      category: "place.retail.food",
      selector: "nearest",
      travelMode: "walk",
      domain: "commerce",
    });
  });

  it("turns drive-to-garage language into travel + drive, not a vehicle minigame", () => {
    const frame = frameFromUtterance("drive to the garage");
    expect(frame).toMatchObject({
      primitive: "travel",
      category: "place.service.garage",
      travelMode: "drive",
      domain: "vehicles",
    });
  });

  it("keeps give-to-mechanic as transfer, not travel to a garage", () => {
    expect(
      frameFromUtterance("Give the Certification Wrench to the Certification Mechanic."),
    ).toMatchObject({
      primitive: "transfer",
      category: "place.service.garage",
    });
  });

  it("forbids clarification except known-instance conflict", () => {
    expect(mayClarify("bound")).toBe(false);
    expect(mayClarify("materialize_from_source")).toBe(false);
    expect(mayClarify("need_source")).toBe(false);
    expect(mayClarify("clarify_known_conflict")).toBe(true);
  });

  it("treats invented success as a contract failure", () => {
    expect(isInventedSuccess("need_source", true)).toBe(true);
    expect(isInventedSuccess("unsupported", true)).toBe(true);
    expect(isInventedSuccess("bound", true)).toBe(false);
    expect(isInventedSuccess("need_source", false)).toBe(false);
  });

  it("covers vehicles, weapons, stores, law, and body in the lexicon", () => {
    const domains = new Set(SANDBOX_NOUN_LEXICON.map((entry) => entry.domain));
    for (const required of [
      "vehicles",
      "weapons_combat",
      "commerce",
      "legal",
      "emergency",
      "economy",
    ] as const) {
      expect(domains.has(required)).toBe(true);
    }
  });
});
