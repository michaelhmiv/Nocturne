import { describe, expect, it } from "vitest";
import { findStockSlot, stockForFamily } from "./family-stock.js";

describe("family stock", () => {
  it("gives a bodega food-ish slots instead of a SKU encyclopedia", () => {
    const stock = stockForFamily("place.retail.food");
    expect(stock.map((slot) => slot.sku)).toEqual(["sandwich", "water", "coffee"]);
  });

  it("gives a pharmacy medical-ish slots", () => {
    expect(stockForFamily("place.retail.pharmacy").map((slot) => slot.sku)).toEqual([
      "bandage",
      "painkiller",
    ]);
  });

  it("gives a garage tools instead of an invented mechanic NPC", () => {
    expect(stockForFamily("place.service.garage").map((slot) => slot.sku)).toEqual([
      "wrench",
      "crowbar",
    ]);
    expect(findStockSlot("Grab wrench from mechanic")).toMatchObject({
      placeFamily: "place.service.garage",
      slot: { sku: "wrench", label: "wrench" },
    });
  });

  it("gives a precinct no retail stock", () => {
    expect(stockForFamily("place.civic.precinct")).toEqual([]);
  });
});
