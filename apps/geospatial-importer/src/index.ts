import { createDatabase, createGeospatialStore } from "@nocturne/database";
import { importArcGisSource, normalizeArcGisConfiguration } from "./arcgis-source.js";

const DEFAULT_MAPPLUTO_FIELDS = [
  "OBJECTID",
  "BBL",
  "Borough",
  "Block",
  "Lot",
  "Address",
  "LandUse",
  "BldgClass",
  "LotArea",
  "BldgArea",
  "NumBldgs",
  "NumFloors",
  "UnitsRes",
  "UnitsTotal",
  "YearBuilt",
  "ZoneDist1",
  "Overlay1",
  "Latitude",
  "Longitude",
];

function integerEnvironment(name: string, fallback?: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return value;
}

function listEnvironment(name: string, fallback: string[]) {
  const raw = process.env[name];
  if (!raw?.trim()) return fallback;
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const datasetKey = process.env.GEOSPATIAL_DATASET_KEY || "nyc_mappluto_public_2026";
  const database = createDatabase(databaseUrl);
  const store = createGeospatialStore(database);
  let importRunId: string | undefined;

  try {
    const dataset = await store.getDataset(datasetKey);
    if (!dataset) throw new Error(`Geospatial dataset ${datasetKey} was not found.`);
    const sourceUrl = process.env.GEOSPATIAL_SOURCE_URL || dataset.source_url;
    const sourceVersion = process.env.GEOSPATIAL_SOURCE_VERSION || dataset.source_version;
    const run = await store.startImport({
      datasetKey,
      sourceVersion,
      requestParameters: {
        sourceUrl,
        where: process.env.GEOSPATIAL_WHERE || "1=1",
        startOffset: integerEnvironment("GEOSPATIAL_START_OFFSET", 0),
        maxFeatures: integerEnvironment("GEOSPATIAL_MAX_FEATURES"),
      },
    });
    importRunId = run.importRunId;

    const result = await importArcGisSource({
      importRunId,
      configuration: normalizeArcGisConfiguration({
        serviceUrl: sourceUrl,
        featureKind: "parcel",
        where: process.env.GEOSPATIAL_WHERE || "1=1",
        outFields: listEnvironment("GEOSPATIAL_OUT_FIELDS", DEFAULT_MAPPLUTO_FIELDS),
        pageSize: integerEnvironment("GEOSPATIAL_PAGE_SIZE", 2_000),
        startOffset: integerEnvironment("GEOSPATIAL_START_OFFSET", 0),
        maxFeatures: integerEnvironment("GEOSPATIAL_MAX_FEATURES"),
        timeoutMs: integerEnvironment("GEOSPATIAL_REQUEST_TIMEOUT_MS", 60_000),
      }),
      store,
      onProgress(progress) {
        console.log(
          JSON.stringify({
            event: "geospatial_import_progress",
            datasetKey,
            importRunId,
            ...progress,
          }),
        );
      },
    });

    await store.finishImport({
      importRunId,
      status: "completed",
      contentChecksum: result.contentChecksum,
    });
    console.log(
      JSON.stringify({
        event: "geospatial_import_completed",
        datasetKey,
        importRunId,
        ...result,
      }),
    );
  } catch (error) {
    if (importRunId) {
      await store
        .finishImport({
          importRunId,
          status: "failed",
          errorSummary: error instanceof Error ? error.message : String(error),
        })
        .catch(() => undefined);
    }
    throw error;
  } finally {
    await database.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      event: "geospatial_import_failed",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  );
  process.exitCode = 1;
});
