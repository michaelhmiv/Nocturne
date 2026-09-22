import { z } from "zod";

export const SandboxPrimitiveSchema = z.enum([
  "travel",
  "perceive",
  "search",
  "operate",
  "transfer",
  "consume",
  "damage",
  "repair",
  "restrain",
  "release",
  "communicate",
  "wait",
  "work",
  "occupy",
]);
export type SandboxPrimitive = z.infer<typeof SandboxPrimitiveSchema>;

export const TravelModeSchema = z.enum([
  "walk",
  "run",
  "sneak",
  "drive",
  "ride",
  "transit",
  "taxi",
  "swim",
  "climb",
]);
export type TravelMode = z.infer<typeof TravelModeSchema>;

export const SandboxSelectorSchema = z.enum([
  "nearest",
  "any",
  "known",
  "named",
  "equipped",
  "carried",
  "owned",
  "here",
  "along_route",
]);
export type SandboxSelector = z.infer<typeof SandboxSelectorSchema>;

export const SandboxDomainSchema = z.enum([
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
export type SandboxDomain = z.infer<typeof SandboxDomainSchema>;

export const CategoryFamilySchema = z.enum([
  "place.street",
  "place.parcel",
  "place.building",
  "place.interior",
  "place.transit",
  "place.retail.food",
  "place.retail.liquor",
  "place.retail.pharmacy",
  "place.retail.hardware",
  "place.retail.electronics",
  "place.retail.clothing",
  "place.retail.pawn",
  "place.retail.weapons",
  "place.service.garage",
  "place.service.fuel",
  "place.service.dealership",
  "place.service.bank",
  "place.service.clinic",
  "place.service.hospital",
  "place.service.barber",
  "place.service.laundry",
  "place.service.gym",
  "place.service.hotel",
  "place.service.restaurant",
  "place.service.bar",
  "place.service.locksmith",
  "place.civic.precinct",
  "place.civic.firehouse",
  "place.civic.courthouse",
  "place.civic.post",
  "item.weapon",
  "item.tool",
  "item.consumable",
  "item.clothing",
  "item.key",
  "item.document",
  "item.cash",
  "vehicle.automobile",
  "vehicle.motorcycle",
  "vehicle.truck",
  "vehicle.transit",
  "actor.civilian",
  "actor.clerk",
  "actor.police",
  "actor.paramedic",
  "actor.fire",
  "body.self",
]);
export type CategoryFamily = z.infer<typeof CategoryFamilySchema>;

export const SANDBOX_NOUN_LEXICON: ReadonlyArray<{
  phrases: readonly string[];
  family: CategoryFamily;
  domain: SandboxDomain;
  defaultPrimitive: SandboxPrimitive;
}> = [
  {
    phrases: ["grocery", "supermarket", "bodega", "corner store", "deli", "food store"],
    family: "place.retail.food",
    domain: "commerce",
    defaultPrimitive: "travel",
  },
  {
    phrases: ["pharmacy", "drugstore"],
    family: "place.retail.pharmacy",
    domain: "commerce",
    defaultPrimitive: "travel",
  },
  {
    phrases: ["gas station", "petrol", "fuel"],
    family: "place.service.fuel",
    domain: "vehicles",
    defaultPrimitive: "travel",
  },
  {
    phrases: ["garage", "mechanic", "auto repair"],
    family: "place.service.garage",
    domain: "vehicles",
    defaultPrimitive: "travel",
  },
  {
    phrases: ["dealership", "car lot"],
    family: "place.service.dealership",
    domain: "vehicles",
    defaultPrimitive: "travel",
  },
  {
    phrases: ["car", "civic", "sedan", "parked car"],
    family: "vehicle.automobile",
    domain: "vehicles",
    defaultPrimitive: "occupy",
  },
  {
    phrases: ["motorcycle", "bike"],
    family: "vehicle.motorcycle",
    domain: "vehicles",
    defaultPrimitive: "occupy",
  },
  {
    phrases: ["gun", "pistol", "rifle", "firearm"],
    family: "item.weapon",
    domain: "weapons_combat",
    defaultPrimitive: "operate",
  },
  {
    phrases: ["knife", "bat", "crowbar"],
    family: "item.weapon",
    domain: "weapons_combat",
    defaultPrimitive: "operate",
  },
  {
    phrases: ["hospital", "ER"],
    family: "place.service.hospital",
    domain: "emergency",
    defaultPrimitive: "travel",
  },
  {
    phrases: ["precinct", "police station"],
    family: "place.civic.precinct",
    domain: "legal",
    defaultPrimitive: "travel",
  },
  {
    phrases: ["bank", "atm"],
    family: "place.service.bank",
    domain: "economy",
    defaultPrimitive: "travel",
  },
  {
    phrases: ["subway", "train", "metro"],
    family: "place.transit",
    domain: "mobility",
    defaultPrimitive: "travel",
  },
  {
    phrases: ["laundromat", "laundry"],
    family: "place.service.laundry",
    domain: "commerce",
    defaultPrimitive: "travel",
  },
  {
    phrases: ["apartment", "home", "unit"],
    family: "place.interior",
    domain: "property",
    defaultPrimitive: "travel",
  },
  {
    phrases: ["wallet", "cash", "money"],
    family: "item.cash",
    domain: "economy",
    defaultPrimitive: "perceive",
  },
  {
    phrases: ["cop", "officer", "police"],
    family: "actor.police",
    domain: "legal",
    defaultPrimitive: "communicate",
  },
  {
    phrases: ["clerk", "cashier"],
    family: "actor.clerk",
    domain: "population",
    defaultPrimitive: "communicate",
  },
];

export const REQUIRED_SANDBOX_DOMAINS: readonly SandboxDomain[] = SandboxDomainSchema.options;

export function lookupNoun(utterance: string): (typeof SANDBOX_NOUN_LEXICON)[number] | null {
  const haystack = utterance.toLowerCase();
  let best: (typeof SANDBOX_NOUN_LEXICON)[number] | null = null;
  let bestLength = 0;
  for (const entry of SANDBOX_NOUN_LEXICON) {
    for (const phrase of entry.phrases) {
      if (haystack.includes(phrase) && phrase.length > bestLength) {
        best = entry;
        bestLength = phrase.length;
      }
    }
  }
  return best;
}

export const IntentFrameSchema = z
  .object({
    primitive: SandboxPrimitiveSchema,
    category: CategoryFamilySchema.optional(),
    selector: SandboxSelectorSchema.default("nearest"),
    travelMode: TravelModeSchema.optional(),
    domain: SandboxDomainSchema,
    rawText: z.string().trim().min(1).max(4_000),
  })
  .strict()
  .superRefine((frame, context) => {
    if (frame.primitive === "travel" && !frame.category && !frame.travelMode) {
      context.addIssue({
        code: "custom",
        path: ["category"],
        message: "Travel requires a destination category or an explicit mode-only continue.",
      });
    }
  });
export type IntentFrame = z.infer<typeof IntentFrameSchema>;

export const ResolutionStatusSchema = z.enum([
  "bound",
  "materialize_from_source",
  "need_source",
  "need_traverse",
  "unsupported",
  "impossible",
  "clarify_known_conflict",
]);
export type ResolutionStatus = z.infer<typeof ResolutionStatusSchema>;

export function mayClarify(status: ResolutionStatus): boolean {
  return status === "clarify_known_conflict";
}

export function isInventedSuccess(status: ResolutionStatus, mutated: boolean): boolean {
  return (
    mutated && (status === "unsupported" || status === "need_source" || status === "impossible")
  );
}

export function frameFromUtterance(rawText: string): IntentFrame | null {
  const noun = lookupNoun(rawText);
  if (!noun) return null;
  const lowered = rawText.toLowerCase();
  const travelIntent = /\b(go|walk|run|drive|head|take me|find)\b/.test(lowered);
  const primitive = travelIntent ? "travel" : noun.defaultPrimitive;
  const travelMode: TravelMode | undefined = /\bdrive\b/.test(lowered)
    ? "drive"
    : /\brun\b/.test(lowered)
      ? "run"
      : primitive === "travel"
        ? "walk"
        : undefined;
  const selector: SandboxSelector = /\bnearest|closest|nearby\b/.test(lowered)
    ? "nearest"
    : /\bmy\b/.test(lowered)
      ? "owned"
      : "nearest";
  return IntentFrameSchema.parse({
    primitive,
    category: noun.family,
    selector,
    travelMode,
    domain: noun.domain,
    rawText,
  });
}
