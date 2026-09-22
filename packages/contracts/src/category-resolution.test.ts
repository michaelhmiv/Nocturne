import { describe, expect, it } from "vitest";
import {
  STARTER_FOUNDRY_ROW_PLACES,
  extractCategoryReference,
  mayClarify,
  resolveCategory,
} from "./category-resolution.js";

describe("category lexicon", () => {
  it("maps grocery paraphrases onto one food-retail category", () => {
    const phrases = [
      "go to the nearest grocery store",
      "head to the bodega",
      "where is the corner store",
      "walk to the supermarket",
      "find a deli",
      "go get groceries",
    ];
    for (const phrase of phrases) {
      const extracted = extractCategoryReference(phrase);
      expect(extracted?.category).toBe("place.retail.food");
      expect(extracted?.kind).toBe("place");
    }
  });

  it("prefers nearest when the player says nearest", () => {
    const extracted = extractCategoryReference("go to the nearest grocery store");
    expect(extracted?.selector).toBe("nearest");
  });
});

describe("clarification policy", () => {
  it("forbids clarification for category and missing references", () => {
    expect(
      mayClarify({
        verbKnown: true,
        resolution: "category",
        candidateEntityIds: [],
      }).allowed,
    ).toBe(false);
    expect(
      mayClarify({
        verbKnown: true,
        resolution: "not_found",
        candidateEntityIds: [],
      }).allowed,
    ).toBe(false);
  });

  it("allows clarification only for a material instance fork", () => {
    const decision = mayClarify({
      verbKnown: true,
      resolution: "ambiguous",
      candidateEntityIds: [STARTER_FOUNDRY_ROW_PLACES.bodegaId, STARTER_FOUNDRY_ROW_PLACES.alleyId],
      candidatesAreMaterialized: true,
      wrongChoiceMutatesDifferentEntity: true,
    });
    expect(decision).toEqual({ allowed: true, reason: "material_instance_fork" });
  });
});

describe("category resolver", () => {
  const bodega = {
    entityId: STARTER_FOUNDRY_ROW_PLACES.bodegaId,
    name: "Row Bodega",
    definitionType: "retail",
    locationId: STARTER_FOUNDRY_ROW_PLACES.rowId,
    known: true,
    indoor: false,
    categories: ["place.retail.food"],
    distance: 40,
  };

  it("binds the existing store instead of asking", () => {
    const result = resolveCategory({
      actorId: "00000000-0000-4000-8000-0000000000aa",
      actorLocationId: STARTER_FOUNDRY_ROW_PLACES.sidewalkId,
      actorIndoor: false,
      category: "place.retail.food",
      selector: "nearest",
      candidates: [bodega],
    });
    expect(result).toMatchObject({
      status: "bound",
      entityId: STARTER_FOUNDRY_ROW_PLACES.bodegaId,
    });
  });

  it("binds the street store from an interior instead of asking", () => {
    const result = resolveCategory({
      actorId: "00000000-0000-4000-8000-0000000000aa",
      actorLocationId: STARTER_FOUNDRY_ROW_PLACES.unitId,
      actorIndoor: true,
      category: "place.retail.food",
      selector: "nearest",
      candidates: [bodega],
      traverseViaId: STARTER_FOUNDRY_ROW_PLACES.sidewalkId,
    });
    expect(result).toMatchObject({
      status: "bound",
      entityId: STARTER_FOUNDRY_ROW_PLACES.bodegaId,
    });
  });

  it("leaves an interior only when no matching place exists yet", () => {
    const result = resolveCategory({
      actorId: "00000000-0000-4000-8000-0000000000aa",
      actorLocationId: STARTER_FOUNDRY_ROW_PLACES.unitId,
      actorIndoor: true,
      category: "place.retail.pharmacy",
      selector: "nearest",
      candidates: [bodega],
      traverseViaId: STARTER_FOUNDRY_ROW_PLACES.sidewalkId,
    });
    expect(result.status).toBe("need_traverse");
    if (result.status === "need_traverse") {
      expect(result.viaLocationId).toBe(STARTER_FOUNDRY_ROW_PLACES.sidewalkId);
    }
  });

  it("reuses the same store when two queries race", () => {
    const first = resolveCategory({
      actorId: "00000000-0000-4000-8000-0000000000aa",
      actorLocationId: STARTER_FOUNDRY_ROW_PLACES.sidewalkId,
      category: "place.retail.food",
      selector: "nearest",
      candidates: [bodega],
    });
    const second = resolveCategory({
      actorId: "00000000-0000-4000-8000-0000000000bb",
      actorLocationId: STARTER_FOUNDRY_ROW_PLACES.sidewalkId,
      category: "place.retail.food",
      selector: "nearest",
      candidates: [bodega],
    });
    expect(first).toMatchObject({ status: "bound", entityId: bodega.entityId });
    expect(second).toMatchObject({ status: "bound", entityId: bodega.entityId });
  });
});
