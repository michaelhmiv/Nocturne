import { describe, expect, it, vi } from "vitest";
import {
  buildArcGisPageUrl,
  convertArcGisFeature,
  importArcGisSource,
  normalizeArcGisConfiguration,
} from "./arcgis-source.js";

const polygon = {
  type: "Polygon",
  coordinates: [
    [
      [-73.99, 40.72],
      [-73.98, 40.72],
      [-73.98, 40.73],
      [-73.99, 40.73],
      [-73.99, 40.72],
    ],
  ],
};

describe("ArcGIS source importer", () => {
  it("builds deterministic ordered GeoJSON page requests", () => {
    const configuration = normalizeArcGisConfiguration({
      serviceUrl: "https://example.test/FeatureServer/0/",
      where: "Borough = 'BK'",
      outFields: ["OBJECTID", "BBL"],
      pageSize: 2_000,
      startOffset: 0,
      timeoutMs: 60_000,
    });
    const url = new URL(
      buildArcGisPageUrl({
        configuration,
        objectIdField: "OBJECTID",
        offset: 4_000,
        pageSize: 2_000,
      }),
    );
    expect(url.pathname).toBe("/FeatureServer/0/query");
    expect(url.searchParams.get("f")).toBe("geojson");
    expect(url.searchParams.get("outSR")).toBe("4326");
    expect(url.searchParams.get("orderByFields")).toBe("OBJECTID ASC");
    expect(url.searchParams.get("resultOffset")).toBe("4000");
    expect(url.searchParams.get("resultRecordCount")).toBe("2000");
  });

  it("converts a GeoJSON feature using the layer object ID", () => {
    const converted = convertArcGisFeature({
      feature: {
        type: "Feature",
        geometry: polygon,
        properties: { OBJECTID: 42, BBL: "3000010001" },
      },
      objectIdField: "OBJECTID",
      featureKind: "parcel",
    });
    expect(converted.providerFeatureId).toBe("42");
    expect(converted.featureKind).toBe("parcel");
    expect(converted.properties.BBL).toBe("3000010001");
  });

  it("pages until exhausted and records progress", async () => {
    const responses = [
      { objectIdField: "OBJECTID", maxRecordCount: 2 },
      {
        type: "FeatureCollection",
        features: [
          { type: "Feature", geometry: polygon, properties: { OBJECTID: 1 } },
          { type: "Feature", geometry: polygon, properties: { OBJECTID: 2 } },
        ],
        exceededTransferLimit: true,
      },
      {
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: polygon, properties: { OBJECTID: 3 } }],
      },
    ];
    const fetchImpl = vi.fn(async () => {
      const value = responses.shift();
      return new Response(JSON.stringify(value), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const upsertSourceFeatures = vi.fn(async ({ features }: { features: unknown[] }) => ({
      inserted: features.length,
      updated: 0,
      unchanged: 0,
    }));
    const onProgress = vi.fn();

    const result = await importArcGisSource({
      importRunId: "10000000-0000-4000-8000-000000000001",
      configuration: normalizeArcGisConfiguration({
        serviceUrl: "https://example.test/FeatureServer/0",
        pageSize: 2,
        startOffset: 0,
        timeoutMs: 1_000,
      }),
      store: { upsertSourceFeatures },
      fetchImpl: fetchImpl as never,
      onProgress,
    });

    expect(result.processed).toBe(3);
    expect(result.inserted).toBe(3);
    expect(result.offset).toBe(3);
    expect(upsertSourceFeatures).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ processed: 3, inserted: 3, offset: 3 }),
    );
  });

  it("rejects missing geometry rather than inventing a parcel", () => {
    expect(() =>
      convertArcGisFeature({
        feature: { type: "Feature", geometry: null, properties: { OBJECTID: 9 } },
        objectIdField: "OBJECTID",
        featureKind: "parcel",
      }),
    ).toThrow(/no geometry/i);
  });
});
