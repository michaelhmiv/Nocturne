import { describe, expect, it } from "vitest";
import { locationSemanticFingerprint } from "./location-materialization-store.js";

const semantics = {
  normalizedFamily: "building" as const,
  semanticType: "warehouse",
  name: "Old Mercer Warehouse",
  conceptSummary: "A disused brick warehouse beside the rail spur.",
  spatialCell: "calder:foundry:mercer:17",
  footprint: { approximateSquareMeters: 1400 },
  accessPattern: { publicEntrances: 1, loadingBays: 2 },
};

describe("location semantic identity", () => {
  it("is stable across harmless whitespace and case changes", () => {
    const parent = "10000000-0000-4000-8000-000000000003";
    const first = locationSemanticFingerprint(parent, semantics);
    const second = locationSemanticFingerprint(parent, {
      ...semantics,
      semanticType: "  WAREHOUSE ",
      name: " old   mercer warehouse ",
      conceptSummary: " A disused brick warehouse beside the rail spur. ",
      spatialCell: "CALDER:FOUNDRY:MERCER:17",
    });
    expect(second).toBe(first);
  });

  it("keeps distinct parent geography distinct", () => {
    expect(
      locationSemanticFingerprint("10000000-0000-4000-8000-000000000003", semantics),
    ).not.toBe(
      locationSemanticFingerprint("10000000-0000-4000-8000-000000000004", semantics),
    );
  });

  it("keeps materially different footprints distinct", () => {
    expect(
      locationSemanticFingerprint(null, semantics),
    ).not.toBe(
      locationSemanticFingerprint(null, {
        ...semantics,
        footprint: { approximateSquareMeters: 14_000 },
      }),
    );
  });
});
