import { createHash } from "node:crypto";
import {
  GeospatialSourceFeatureSchema,
  type GeospatialSourceFeature,
} from "@nocturne/contracts";

export type ArcGisLayerMetadata = {
  objectIdField?: string;
  objectIdFieldName?: string;
  maxRecordCount?: number;
};

export type ArcGisFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    id?: string | number;
    geometry: unknown;
    properties?: Record<string, unknown> | null;
  }>;
  exceededTransferLimit?: boolean;
};

export type ArcGisImportConfiguration = {
  serviceUrl: string;
  featureKind: GeospatialSourceFeature["featureKind"];
  where: string;
  outFields: string[];
  pageSize: number;
  startOffset: number;
  maxFeatures?: number;
  timeoutMs: number;
};

export type ArcGisImportStore = {
  upsertSourceFeatures(input: {
    importRunId: string;
    features: GeospatialSourceFeature[];
  }): Promise<{ inserted: number; updated: number; unchanged: number }>;
};

function positiveInteger(value: unknown, fallback: number, maximum: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

export function normalizeArcGisConfiguration(
  input: Partial<ArcGisImportConfiguration> & Pick<ArcGisImportConfiguration, "serviceUrl">,
): ArcGisImportConfiguration {
  const serviceUrl = input.serviceUrl.replace(/\/+$/, "");
  if (!/^https:\/\//i.test(serviceUrl)) {
    throw new Error("ArcGIS source URL must use HTTPS.");
  }
  return {
    serviceUrl,
    featureKind: input.featureKind ?? "parcel",
    where: input.where?.trim() || "1=1",
    outFields: input.outFields?.filter(Boolean) ?? ["*"],
    pageSize: positiveInteger(input.pageSize, 2_000, 2_000),
    startOffset: Math.max(0, Math.floor(input.startOffset ?? 0)),
    ...(input.maxFeatures && input.maxFeatures > 0
      ? { maxFeatures: Math.floor(input.maxFeatures) }
      : {}),
    timeoutMs: positiveInteger(input.timeoutMs, 60_000, 300_000),
  };
}

export function buildArcGisMetadataUrl(serviceUrl: string) {
  const url = new URL(serviceUrl.replace(/\/+$/, ""));
  url.searchParams.set("f", "json");
  return url.toString();
}

export function buildArcGisPageUrl(input: {
  configuration: ArcGisImportConfiguration;
  objectIdField: string;
  offset: number;
  pageSize: number;
}) {
  const url = new URL(`${input.configuration.serviceUrl}/query`);
  url.searchParams.set("where", input.configuration.where);
  url.searchParams.set("outFields", input.configuration.outFields.join(","));
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("f", "geojson");
  url.searchParams.set("orderByFields", `${input.objectIdField} ASC`);
  url.searchParams.set("resultOffset", String(input.offset));
  url.searchParams.set("resultRecordCount", String(input.pageSize));
  return url.toString();
}

async function fetchJson<T>(input: {
  fetchImpl: typeof fetch;
  url: string;
  timeoutMs: number;
  attempts?: number;
}): Promise<T> {
  const attempts = input.attempts ?? 4;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await input.fetchImpl(input.url, {
        headers: { accept: "application/json", "user-agent": "Nocturne-Geospatial-Importer/1" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`ArcGIS request failed with HTTP ${response.status}.`);
      }
      const value = (await response.json()) as T & { error?: { message?: string } };
      if (value && typeof value === "object" && "error" in value && value.error) {
        throw new Error(value.error.message || "ArcGIS returned an error payload.");
      }
      return value;
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, Math.min(8_000, 500 * 2 ** attempt)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("ArcGIS request failed.");
}

export function convertArcGisFeature(input: {
  feature: ArcGisFeatureCollection["features"][number];
  objectIdField: string;
  featureKind: GeospatialSourceFeature["featureKind"];
}): GeospatialSourceFeature {
  const properties = input.feature.properties ?? {};
  const providerId = properties[input.objectIdField] ?? input.feature.id;
  if (providerId === undefined || providerId === null || String(providerId).trim() === "") {
    throw new Error(`ArcGIS feature is missing ${input.objectIdField}.`);
  }
  if (!input.feature.geometry) {
    throw new Error(`ArcGIS feature ${String(providerId)} has no geometry.`);
  }
  return GeospatialSourceFeatureSchema.parse({
    providerFeatureId: String(providerId),
    featureKind: input.featureKind,
    geometry: input.feature.geometry,
    properties,
  });
}

export async function importArcGisSource(input: {
  importRunId: string;
  configuration: ArcGisImportConfiguration;
  store: ArcGisImportStore;
  fetchImpl?: typeof fetch;
  onProgress?(progress: {
    offset: number;
    processed: number;
    inserted: number;
    updated: number;
    unchanged: number;
  }): void;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const metadata = await fetchJson<ArcGisLayerMetadata>({
    fetchImpl,
    url: buildArcGisMetadataUrl(input.configuration.serviceUrl),
    timeoutMs: input.configuration.timeoutMs,
  });
  const objectIdField = metadata.objectIdField || metadata.objectIdFieldName;
  if (!objectIdField) throw new Error("ArcGIS layer metadata does not declare an object ID field.");
  const pageSize = Math.min(
    input.configuration.pageSize,
    positiveInteger(metadata.maxRecordCount, input.configuration.pageSize, 2_000),
  );

  const checksum = createHash("sha256");
  let offset = input.configuration.startOffset;
  let processed = 0;
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  while (true) {
    const remaining = input.configuration.maxFeatures
      ? input.configuration.maxFeatures - processed
      : pageSize;
    if (remaining <= 0) break;
    const requestedPageSize = Math.min(pageSize, remaining);
    const collection = await fetchJson<ArcGisFeatureCollection>({
      fetchImpl,
      url: buildArcGisPageUrl({
        configuration: input.configuration,
        objectIdField,
        offset,
        pageSize: requestedPageSize,
      }),
      timeoutMs: input.configuration.timeoutMs,
    });
    if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
      throw new Error("ArcGIS did not return a GeoJSON FeatureCollection.");
    }
    if (collection.features.length === 0) break;

    const features = collection.features.map((feature) =>
      convertArcGisFeature({
        feature,
        objectIdField,
        featureKind: input.configuration.featureKind,
      }),
    );
    checksum.update(JSON.stringify(features));
    const result = await input.store.upsertSourceFeatures({
      importRunId: input.importRunId,
      features,
    });
    processed += features.length;
    inserted += result.inserted;
    updated += result.updated;
    unchanged += result.unchanged;
    offset += features.length;
    input.onProgress?.({ offset, processed, inserted, updated, unchanged });

    if (features.length < requestedPageSize && !collection.exceededTransferLimit) break;
  }

  return {
    objectIdField,
    pageSize,
    offset,
    processed,
    inserted,
    updated,
    unchanged,
    contentChecksum: checksum.digest("hex"),
  };
}
