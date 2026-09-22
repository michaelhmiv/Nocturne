import { z } from "zod";
import { CategoryFamilySchema, type CategoryFamily } from "./sandbox-systems.js";

export const SourceClassMatchSchema = z
  .object({
    key: z.string().trim().min(1).max(40),
    values: z.array(z.string().trim().min(1).max(80)).min(1).max(32),
  })
  .strict();
export type SourceClassMatch = z.infer<typeof SourceClassMatchSchema>;

export const CATEGORY_SOURCE_CLASSES: Record<CategoryFamily, readonly SourceClassMatch[]> = {
  "place.street": [{ key: "highway", values: ["residential", "primary", "secondary", "tertiary"] }],
  "place.parcel": [{ key: "landuse", values: ["residential", "retail", "commercial"] }],
  "place.building": [{ key: "building", values: ["yes", "retail", "apartments", "commercial"] }],
  "place.interior": [],
  "place.transit": [
    { key: "station", values: ["subway"] },
    { key: "public_transport", values: ["station"] },
    { key: "railway", values: ["station"] },
  ],
  "place.retail.food": [
    { key: "shop", values: ["convenience", "supermarket", "greengrocer", "deli", "grocery"] },
    { key: "amenity", values: ["marketplace"] },
  ],
  "place.retail.liquor": [{ key: "shop", values: ["alcohol", "wine"] }],
  "place.retail.pharmacy": [
    { key: "amenity", values: ["pharmacy"] },
    { key: "shop", values: ["chemist"] },
  ],
  "place.retail.hardware": [{ key: "shop", values: ["hardware", "doityourself"] }],
  "place.retail.electronics": [{ key: "shop", values: ["electronics", "mobile_phone"] }],
  "place.retail.clothing": [{ key: "shop", values: ["clothes", "fashion"] }],
  "place.retail.pawn": [{ key: "shop", values: ["pawnbroker", "second_hand"] }],
  "place.retail.weapons": [{ key: "shop", values: ["guns", "weapons"] }],
  "place.service.garage": [
    { key: "shop", values: ["car_repair"] },
    { key: "amenity", values: ["car_repair"] },
  ],
  "place.service.fuel": [{ key: "amenity", values: ["fuel"] }],
  "place.service.dealership": [{ key: "shop", values: ["car"] }],
  "place.service.bank": [
    { key: "amenity", values: ["bank", "atm"] },
    { key: "shop", values: ["money_lender"] },
  ],
  "place.service.clinic": [{ key: "amenity", values: ["clinic"] }],
  "place.service.hospital": [{ key: "amenity", values: ["hospital"] }],
  "place.service.barber": [{ key: "shop", values: ["hairdresser"] }],
  "place.service.laundry": [{ key: "shop", values: ["laundry"] }],
  "place.service.gym": [{ key: "leisure", values: ["fitness_centre"] }],
  "place.service.hotel": [{ key: "tourism", values: ["hotel", "motel"] }],
  "place.service.restaurant": [{ key: "amenity", values: ["restaurant", "fast_food", "cafe"] }],
  "place.service.bar": [{ key: "amenity", values: ["bar", "pub"] }],
  "place.service.locksmith": [{ key: "shop", values: ["locksmith"] }],
  "place.civic.precinct": [{ key: "amenity", values: ["police"] }],
  "place.civic.firehouse": [{ key: "amenity", values: ["fire_station"] }],
  "place.civic.courthouse": [{ key: "amenity", values: ["courthouse"] }],
  "place.civic.post": [{ key: "amenity", values: ["post_office"] }],
  "item.weapon": [],
  "item.tool": [],
  "item.consumable": [],
  "item.clothing": [],
  "item.key": [],
  "item.document": [],
  "item.cash": [],
  "vehicle.automobile": [{ key: "amenity", values: ["parking"] }],
  "vehicle.motorcycle": [],
  "vehicle.truck": [],
  "vehicle.transit": [{ key: "route", values: ["subway", "bus"] }],
  "actor.civilian": [],
  "actor.clerk": [],
  "actor.police": [],
  "actor.paramedic": [],
  "actor.fire": [],
  "body.self": [],
};

export function sourceClassesFor(family: CategoryFamily): readonly SourceClassMatch[] {
  return CATEGORY_SOURCE_CLASSES[CategoryFamilySchema.parse(family)];
}

export function familyFromProperties(
  properties: Record<string, unknown>,
): CategoryFamily | undefined {
  for (const family of Object.keys(CATEGORY_SOURCE_CLASSES) as CategoryFamily[]) {
    if (family.startsWith("place.") && featureMatchesFamily(properties, family)) {
      return family;
    }
  }
  return undefined;
}

export function featureMatchesFamily(
  properties: Record<string, unknown>,
  family: CategoryFamily,
): boolean {
  const matches = sourceClassesFor(family);
  if (matches.length === 0) return false;
  return matches.some((match) => {
    const raw = properties[match.key];
    if (typeof raw !== "string") return false;
    return match.values.includes(raw.toLowerCase());
  });
}
