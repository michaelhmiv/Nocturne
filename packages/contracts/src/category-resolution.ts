import { z } from "zod";

const UuidSchema = z.string().uuid();
const SlugSchema = z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/);

export const CategorySelectorSchema = z.enum(["this", "nearest", "any", "named"]);
export type CategorySelector = z.infer<typeof CategorySelectorSchema>;

export const CategoryResolutionStatusSchema = z.enum([
  "bound",
  "need_traverse",
  "discoverable",
  "materializable",
  "impossible",
  "ambiguous",
]);
export type CategoryResolutionStatus = z.infer<typeof CategoryResolutionStatusSchema>;

export type CategoryLexiconEntry = {
  category: string;
  kind: "place" | "item" | "actor";
  synonyms: string[];
  streetLevel?: boolean;
};

export const CATEGORY_LEXICON: CategoryLexiconEntry[] = [
  {
    category: "place.retail.food",
    kind: "place",
    streetLevel: true,
    synonyms: [
      "grocery",
      "grocery store",
      "supermarket",
      "bodega",
      "corner store",
      "corner shop",
      "deli",
      "market",
      "food store",
      "food market",
      "groceries",
    ],
  },
  {
    category: "place.street",
    kind: "place",
    streetLevel: true,
    synonyms: ["street", "sidewalk", "outside", "outdoors", "the block", "block"],
  },
  {
    category: "place.retail.pharmacy",
    kind: "place",
    streetLevel: true,
    synonyms: ["pharmacy", "drugstore", "drug store", "chemist"],
  },
  {
    category: "place.food.service",
    kind: "place",
    streetLevel: true,
    synonyms: ["cafe", "coffee shop", "diner", "restaurant"],
  },
  {
    category: "place.residence.exit",
    kind: "place",
    synonyms: ["door", "front door", "lobby", "stairs", "stairwell", "hallway", "hall"],
  },
  {
    category: "item.drink",
    kind: "item",
    synonyms: ["water", "bottle of water", "water bottle", "soda", "drink"],
  },
  {
    category: "item.food",
    kind: "item",
    synonyms: ["sandwich", "food", "snack", "groceries"],
  },
  {
    category: "actor.vendor",
    kind: "actor",
    synonyms: ["clerk", "cashier", "shopkeeper", "guy behind the counter"],
  },
];

export const STARTER_FOUNDRY_ROW_PLACES = {
  cityId: "10000000-0000-4000-8000-000000000001",
  wardId: "10000000-0000-4000-8000-000000000002",
  rowId: "10000000-0000-4000-8000-000000000003",
  apartmentsId: "10000000-0000-4000-8000-000000000004",
  unitId: "10000000-0000-4000-8000-000000000005",
  alleyId: "10000000-0000-4000-8000-000000000006",
  sidewalkId: "10000000-0000-4000-8000-000000000007",
  bodegaId: "10000000-0000-4000-8000-000000000008",
  waterId: "10000000-0000-4000-8000-000000000009",
  clerkId: "10000000-0000-4000-8000-00000000000a",
} as const;

export type ExtractedCategoryReference = {
  category: string;
  selector: CategorySelector;
  kind: CategoryLexiconEntry["kind"];
  matchedText: string;
  streetLevel: boolean;
};

function normalized(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function selectorFromText(text: string): CategorySelector {
  if (/\b(?:this|the current)\b/i.test(text)) return "this";
  if (/\b(?:nearest|closest|nearby|near(?:est)?|the closest)\b/i.test(text)) return "nearest";
  if (/\b(?:named|called)\b/i.test(text)) return "named";
  return "any";
}

export function extractCategoryReference(command: string): ExtractedCategoryReference | null {
  const haystack = ` ${normalized(command)} `;
  const ranked = CATEGORY_LEXICON.flatMap((entry) =>
    entry.synonyms
      .map((synonym) => {
        const needle = ` ${normalized(synonym)} `;
        if (!haystack.includes(needle)) return null;
        return { entry, synonym, length: normalized(synonym).length };
      })
      .filter((value): value is { entry: CategoryLexiconEntry; synonym: string; length: number } =>
        Boolean(value),
      ),
  ).sort((left, right) => right.length - left.length);
  const match = ranked[0];
  if (!match) return null;
  return {
    category: match.entry.category,
    selector: selectorFromText(command),
    kind: match.entry.kind,
    matchedText: match.synonym,
    streetLevel: Boolean(match.entry.streetLevel),
  };
}

export const ClarificationDecisionSchema = z
  .object({
    allowed: z.boolean(),
    reason: z.string().trim().min(1).max(300),
  })
  .strict();

export function mayClarify(input: {
  verbKnown: boolean;
  resolution: string;
  candidateEntityIds: string[];
  candidatesAreMaterialized?: boolean;
  wrongChoiceMutatesDifferentEntity?: boolean;
}): { allowed: boolean; reason: string } {
  if (!input.verbKnown) {
    return { allowed: false, reason: "verb_unknown" };
  }
  if (input.resolution === "category" || input.resolution === "not_found") {
    return { allowed: false, reason: "category_or_missing_is_not_ambiguity" };
  }
  if (input.resolution !== "ambiguous") {
    return { allowed: false, reason: "not_ambiguous" };
  }
  if (input.candidateEntityIds.length < 2) {
    return { allowed: false, reason: "fewer_than_two_instances" };
  }
  if (input.candidatesAreMaterialized === false) {
    return { allowed: false, reason: "candidates_not_materialized" };
  }
  if (input.wrongChoiceMutatesDifferentEntity === false) {
    return { allowed: false, reason: "choice_is_not_material" };
  }
  return { allowed: true, reason: "material_instance_fork" };
}

export const CategoryCandidateSchema = z
  .object({
    entityId: UuidSchema,
    name: z.string().trim().min(1).max(240),
    definitionType: z.string().trim().min(1).max(100),
    definitionId: z.string().trim().min(1).max(160).optional(),
    locationId: UuidSchema.nullable(),
    known: z.boolean().default(false),
    indoor: z.boolean().default(false),
    categories: z.array(SlugSchema).max(16).default([]),
    distance: z.number().nonnegative().optional(),
  })
  .strict();
export type CategoryCandidate = z.infer<typeof CategoryCandidateSchema>;

export const CategoryResolveInputSchema = z
  .object({
    actorId: UuidSchema,
    actorLocationId: UuidSchema.nullable(),
    actorIndoor: z.boolean().default(false),
    category: SlugSchema,
    selector: CategorySelectorSchema,
    candidates: z.array(CategoryCandidateSchema).max(128),
    traverseViaId: UuidSchema.optional(),
  })
  .strict();
export type CategoryResolveInput = z.infer<typeof CategoryResolveInputSchema>;

export const CategoryResolveResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("bound"),
      entityId: UuidSchema,
      reason: z.string().trim().min(1).max(300),
    })
    .strict(),
  z
    .object({
      status: z.literal("need_traverse"),
      viaLocationId: UuidSchema,
      pendingCategory: SlugSchema,
      reason: z.string().trim().min(1).max(300),
    })
    .strict(),
  z
    .object({
      status: z.literal("discoverable"),
      areaId: UuidSchema,
      reason: z.string().trim().min(1).max(300),
    })
    .strict(),
  z
    .object({
      status: z.literal("materializable"),
      parentLocationId: UuidSchema,
      reason: z.string().trim().min(1).max(300),
    })
    .strict(),
  z
    .object({
      status: z.literal("impossible"),
      reason: z.string().trim().min(1).max(300),
    })
    .strict(),
  z
    .object({
      status: z.literal("ambiguous"),
      entityIds: z.array(UuidSchema).min(2).max(8),
      labels: z.array(z.string().trim().min(1).max(240)).min(2).max(8),
      reason: z.string().trim().min(1).max(300),
    })
    .strict(),
]);
export type CategoryResolveResult = z.infer<typeof CategoryResolveResultSchema>;

function matchesCategory(candidate: CategoryCandidate, category: string) {
  if (candidate.categories.includes(category)) return true;
  const entry = CATEGORY_LEXICON.find((item) => item.category === category);
  if (!entry) return false;
  const haystack = normalized(
    `${candidate.name} ${candidate.definitionType} ${candidate.definitionId || ""}`,
  );
  return entry.synonyms.some((synonym) => haystack.includes(normalized(synonym)));
}

export function resolveCategory(input: CategoryResolveInput): CategoryResolveResult {
  const parsed = CategoryResolveInputSchema.parse(input);
  const matching = parsed.candidates
    .filter((candidate) => candidate.entityId !== parsed.actorId)
    .filter((candidate) => matchesCategory(candidate, parsed.category))
    .sort(
      (left, right) =>
        Number(right.known) - Number(left.known) ||
        (left.distance ?? Number.POSITIVE_INFINITY) -
          (right.distance ?? Number.POSITIVE_INFINITY) ||
        left.entityId.localeCompare(right.entityId),
    );

  if (matching.length >= 2 && parsed.selector !== "nearest" && parsed.selector !== "any") {
    const equalDistance =
      matching[0]?.distance !== undefined &&
      matching[1]?.distance !== undefined &&
      matching[0].distance === matching[1].distance;
    if (equalDistance || parsed.selector === "named") {
      return CategoryResolveResultSchema.parse({
        status: "ambiguous",
        entityIds: matching.slice(0, 2).map((candidate) => candidate.entityId),
        labels: matching.slice(0, 2).map((candidate) => candidate.name),
        reason: "multiple_known_instances",
      });
    }
  }

  if (matching[0]) {
    const bound = matching[0];
    return CategoryResolveResultSchema.parse({
      status: "bound",
      entityId: bound.entityId,
      reason: parsed.selector === "nearest" ? "nearest_match" : "first_stable_match",
    });
  }

  if (parsed.actorIndoor && parsed.traverseViaId) {
    return CategoryResolveResultSchema.parse({
      status: "need_traverse",
      viaLocationId: parsed.traverseViaId,
      pendingCategory: parsed.category,
      reason: "no_match_indoors_leave_first",
    });
  }

  if (parsed.actorLocationId) {
    return CategoryResolveResultSchema.parse({
      status: "discoverable",
      areaId: parsed.actorLocationId,
      reason: "search_current_area",
    });
  }

  return CategoryResolveResultSchema.parse({
    status: "impossible",
    reason: "no_category_match",
  });
}
