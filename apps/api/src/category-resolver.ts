import {
  STARTER_FOUNDRY_ROW_PLACES,
  extractCategoryReference,
  resolveCategory,
  type CategoryCandidate,
  type CategoryResolveResult,
  type RelevanceCompiledContext,
} from "@nocturne/contracts";

const indoorTypes = /(?:residence|apartment|unit|room|interior)/i;

export function contextCategoryCandidates(
  context: RelevanceCompiledContext,
  actorId: string,
): CategoryCandidate[] {
  return (context.entities || [])
    .filter((entity) => entity.entityId !== actorId)
    .map((entity) => ({
      entityId: entity.entityId,
      name: entity.name,
      definitionType: entity.definitionType,
      definitionId: entity.definitionId,
      locationId: entity.locationId,
      known: entity.visibility === "player_known",
      indoor: indoorTypes.test(entity.definitionType),
      categories: [],
    }));
}

function withSeededRetail(candidates: CategoryCandidate[]) {
  const existing = new Set(candidates.map((candidate) => candidate.entityId));
  if (existing.has(STARTER_FOUNDRY_ROW_PLACES.bodegaId)) return candidates;
  return [
    ...candidates,
    {
      entityId: STARTER_FOUNDRY_ROW_PLACES.bodegaId,
      name: "Row Bodega",
      definitionType: "retail",
      definitionId: "WORLD-FOUNDRY-ROW-BODEGA",
      locationId: STARTER_FOUNDRY_ROW_PLACES.rowId,
      known: true,
      indoor: false,
      categories: ["place.retail.food"],
    },
    {
      entityId: STARTER_FOUNDRY_ROW_PLACES.sidewalkId,
      name: "Foundry Row sidewalk",
      definitionType: "location",
      definitionId: "WORLD-FOUNDRY-ROW-SIDEWALK",
      locationId: STARTER_FOUNDRY_ROW_PLACES.rowId,
      known: true,
      indoor: false,
      categories: ["place.street"],
    },
  ];
}

export function resolveCommandDestination(input: {
  command: string;
  actorId: string;
  context: RelevanceCompiledContext;
}): CategoryResolveResult | null {
  const extracted = extractCategoryReference(input.command);
  if (!extracted || extracted.kind !== "place") return null;
  const actor = (input.context.entities || []).find((entity) => entity.entityId === input.actorId);
  const actorIndoor =
    indoorTypes.test(actor?.definitionType || "") ||
    actor?.locationId === STARTER_FOUNDRY_ROW_PLACES.unitId;
  return resolveCategory({
    actorId: input.actorId,
    actorLocationId: actor?.locationId ?? null,
    actorIndoor,
    category: extracted.category,
    selector: extracted.selector,
    candidates: withSeededRetail(contextCategoryCandidates(input.context, input.actorId)),
    traverseViaId: STARTER_FOUNDRY_ROW_PLACES.sidewalkId,
  });
}

export function destinationIdFromResolution(result: CategoryResolveResult): string | null {
  if (result.status === "bound") return result.entityId;
  if (result.status === "need_traverse") return result.viaLocationId;
  if (result.status === "discoverable") return result.areaId;
  return null;
}
