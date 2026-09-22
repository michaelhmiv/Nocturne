import type { CategoryFamily } from "./sandbox-systems.js";

export type StockSlot = {
  sku: string;
  family: CategoryFamily;
  label: string;
};

const FOOD: StockSlot[] = [
  { sku: "sandwich", family: "item.consumable", label: "sandwich" },
  { sku: "water", family: "item.consumable", label: "bottled water" },
  { sku: "coffee", family: "item.consumable", label: "coffee" },
];

const PHARMACY: StockSlot[] = [
  { sku: "bandage", family: "item.consumable", label: "bandage" },
  { sku: "painkiller", family: "item.consumable", label: "painkiller" },
];

const HARDWARE: StockSlot[] = [
  { sku: "crowbar", family: "item.tool", label: "crowbar" },
  { sku: "flashlight", family: "item.tool", label: "flashlight" },
  { sku: "wrench", family: "item.tool", label: "wrench" },
];

const GARAGE: StockSlot[] = [
  { sku: "wrench", family: "item.tool", label: "wrench" },
  { sku: "crowbar", family: "item.tool", label: "crowbar" },
];

const WEAPONS: StockSlot[] = [{ sku: "ammo-9mm", family: "item.weapon", label: "9mm ammunition" }];

export const FAMILY_STOCK: Partial<Record<CategoryFamily, readonly StockSlot[]>> = {
  "place.retail.food": FOOD,
  "place.service.restaurant": FOOD,
  "place.service.bar": [
    { sku: "beer", family: "item.consumable", label: "beer" },
    { sku: "water", family: "item.consumable", label: "water" },
  ],
  "place.retail.liquor": [{ sku: "whiskey", family: "item.consumable", label: "whiskey" }],
  "place.retail.pharmacy": PHARMACY,
  "place.service.clinic": PHARMACY,
  "place.retail.hardware": HARDWARE,
  "place.service.garage": GARAGE,
  "place.retail.weapons": WEAPONS,
  "place.service.fuel": [{ sku: "fuel-can", family: "item.tool", label: "fuel can" }],
};

export function stockForFamily(family: CategoryFamily): readonly StockSlot[] {
  return FAMILY_STOCK[family] ?? [];
}

export function findStockSlot(utterance: string): {
  slot: StockSlot;
  placeFamily: CategoryFamily;
} | null {
  const haystack = utterance.toLowerCase();
  let best: { slot: StockSlot; placeFamily: CategoryFamily; length: number } | null = null;
  for (const [family, slots] of Object.entries(FAMILY_STOCK) as Array<
    [CategoryFamily, readonly StockSlot[]]
  >) {
    for (const slot of slots) {
      const needle = slot.label.toLowerCase();
      const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`).test(haystack)) continue;
      if (!best || needle.length > best.length) {
        best = { slot, placeFamily: family, length: needle.length };
      }
    }
  }
  return best ? { slot: best.slot, placeFamily: best.placeFamily } : null;
}
