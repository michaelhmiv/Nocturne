import { createHash } from "node:crypto";
import {
  CanonicalSpatialEntityInputSchema,
  GeospatialImportRequestSchema,
  GeospatialSourceFeatureSchema,
  SpatialBoundingBoxQuerySchema,
  calculateSpatialBounds,
  type CanonicalSpatialEntityInput,
  type GeospatialImportRequest,
  type GeospatialSourceFeature,
  type SpatialBoundingBoxQuery,
} from "@nocturne/contracts";
import type { createDatabase } from "./index.js";
import { serializeJson as json } from "./json.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalize(nested)]),
    );
  }
  return value;
}

export function geospatialSourceHash(feature: GeospatialSourceFeature) {
  const parsed = GeospatialSourceFeatureSchema.parse(feature);
  return createHash("sha256").update(JSON.stringify(canonicalize(parsed))).digest("hex");
}

export class GeospatialStoreError extends Error {
  constructor(
    readonly code:
      | "dataset_not_found"
      | "import_not_found"
      | "import_not_running"
      | "invalid_input"
      | "canonical_conflict",
    message: string,
  ) {
    super(message);
    this.name = "GeospatialStoreError";
  }
}

export function createGeospatialStore(database: ReturnType<typeof createDatabase>) {
  async function getDataset(datasetKey: string) {
    const rows = await database.client<
      Array<{
        dataset_id: string;
        dataset_key: string;
        provider: string;
        title: string;
        source_url: string;
        license_name: string | null;
        attribution_text: string | null;
        source_version: string;
        source_updated_at: Date | null;
        geometry_crs: string;
        feature_kind: string;
        configuration: Record<string, unknown>;
        active: boolean;
      }>
    >`
      SELECT dataset_id, dataset_key, provider, title, source_url, license_name,
             attribution_text, source_version, source_updated_at, geometry_crs,
             feature_kind, configuration, active
      FROM source_geo.datasets
      WHERE dataset_key = ${datasetKey}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  async function startImport(request: GeospatialImportRequest) {
    const parsed = GeospatialImportRequestSchema.parse(request);
    const dataset = await getDataset(parsed.datasetKey);
    if (!dataset || !dataset.active) {
      throw new GeospatialStoreError(
        "dataset_not_found",
        `Active geospatial dataset ${parsed.datasetKey} was not found.`,
      );
    }
    const rows = await database.client<Array<{ import_run_id: string; started_at: Date }>>`
      INSERT INTO source_geo.import_runs (
        dataset_id, status, source_version, request_parameters, started_at
      )
      VALUES (
        ${dataset.dataset_id}, 'running', ${parsed.sourceVersion},
        ${json(parsed.requestParameters)}::jsonb, now()
      )
      RETURNING import_run_id, started_at
    `;
    return {
      importRunId: rows[0]!.import_run_id,
      datasetId: dataset.dataset_id,
      datasetKey: dataset.dataset_key,
      startedAt: rows[0]!.started_at.toISOString(),
    };
  }

  async function loadRunningImport(importRunId: string) {
    const rows = await database.client<
      Array<{
        import_run_id: string;
        dataset_id: string;
        dataset_key: string;
        status: string;
      }>
    >`
      SELECT run.import_run_id, run.dataset_id, dataset.dataset_key, run.status
      FROM source_geo.import_runs run
      JOIN source_geo.datasets dataset ON dataset.dataset_id = run.dataset_id
      WHERE run.import_run_id = ${importRunId}
      LIMIT 1
    `;
    if (!rows[0]) {
      throw new GeospatialStoreError("import_not_found", "Geospatial import run was not found.");
    }
    if (rows[0].status !== "running") {
      throw new GeospatialStoreError(
        "import_not_running",
        `Geospatial import run is ${rows[0].status}, not running.`,
      );
    }
    return rows[0];
  }

  async function upsertSourceFeatures(input: {
    importRunId: string;
    features: GeospatialSourceFeature[];
  }) {
    if (input.features.length === 0) return { inserted: 0, updated: 0, unchanged: 0 };
    if (input.features.length > 2_000) {
      throw new GeospatialStoreError(
        "invalid_input",
        "A geospatial import batch cannot exceed 2,000 features.",
      );
    }
    const run = await loadRunningImport(input.importRunId);
    const features = input.features.map((feature) => GeospatialSourceFeatureSchema.parse(feature));

    return database.client.begin(async (transaction) => {
      let inserted = 0;
      let updated = 0;
      let unchanged = 0;
      for (const feature of features) {
        const bounds = calculateSpatialBounds(feature.geometry);
        const sourceHash = geospatialSourceHash(feature);
        const rows = await transaction<
          Array<{ inserted: boolean; changed: boolean }>
        >`
          INSERT INTO source_geo.features (
            dataset_id, import_run_id, provider_feature_id, feature_kind,
            geometry_type, geometry, properties,
            min_longitude, min_latitude, max_longitude, max_latitude,
            centroid_longitude, centroid_latitude, source_hash,
            source_updated_at, active, updated_at
          )
          VALUES (
            ${run.dataset_id}, ${input.importRunId}, ${feature.providerFeatureId},
            ${feature.featureKind}, ${feature.geometry.type},
            ${json(feature.geometry)}::jsonb, ${json(feature.properties)}::jsonb,
            ${bounds.minLongitude}, ${bounds.minLatitude},
            ${bounds.maxLongitude}, ${bounds.maxLatitude},
            ${bounds.centroidLongitude}, ${bounds.centroidLatitude}, ${sourceHash},
            ${feature.sourceUpdatedAt ? new Date(feature.sourceUpdatedAt) : null}, true, now()
          )
          ON CONFLICT (dataset_id, provider_feature_id) DO UPDATE SET
            import_run_id = EXCLUDED.import_run_id,
            feature_kind = EXCLUDED.feature_kind,
            geometry_type = EXCLUDED.geometry_type,
            geometry = EXCLUDED.geometry,
            properties = EXCLUDED.properties,
            min_longitude = EXCLUDED.min_longitude,
            min_latitude = EXCLUDED.min_latitude,
            max_longitude = EXCLUDED.max_longitude,
            max_latitude = EXCLUDED.max_latitude,
            centroid_longitude = EXCLUDED.centroid_longitude,
            centroid_latitude = EXCLUDED.centroid_latitude,
            source_hash = EXCLUDED.source_hash,
            source_updated_at = EXCLUDED.source_updated_at,
            active = true,
            updated_at = CASE
              WHEN source_geo.features.source_hash <> EXCLUDED.source_hash THEN now()
              ELSE source_geo.features.updated_at
            END
          RETURNING
            (xmax = 0) AS inserted,
            (xmax = 0 OR source_geo.features.source_hash = ${sourceHash}) AS changed
        `;
        if (rows[0]!.inserted) inserted += 1;
        else if (rows[0]!.changed) updated += 1;
        else unchanged += 1;
      }

      await transaction`
        UPDATE source_geo.import_runs
        SET feature_count = feature_count + ${features.length},
            inserted_count = inserted_count + ${inserted},
            updated_count = updated_count + ${updated},
            skipped_count = skipped_count + ${unchanged}
        WHERE import_run_id = ${input.importRunId}
      `;
      return { inserted, updated, unchanged };
    });
  }

  async function finishImport(input: {
    importRunId: string;
    status: "completed" | "failed" | "cancelled";
    contentChecksum?: string;
    errorSummary?: string;
  }) {
    await loadRunningImport(input.importRunId);
    const rows = await database.client<
      Array<{
        import_run_id: string;
        status: string;
        feature_count: number;
        inserted_count: number;
        updated_count: number;
        skipped_count: number;
        error_count: number;
        completed_at: Date;
      }>
    >`
      UPDATE source_geo.import_runs
      SET status = ${input.status},
          content_checksum = ${input.contentChecksum ?? null},
          error_summary = ${input.errorSummary ?? null},
          error_count = CASE WHEN ${input.status} = 'failed' THEN GREATEST(error_count, 1) ELSE error_count END,
          completed_at = now()
      WHERE import_run_id = ${input.importRunId}
      RETURNING import_run_id, status, feature_count, inserted_count,
                updated_count, skipped_count, error_count, completed_at
    `;
    return {
      ...rows[0]!,
      completedAt: rows[0]!.completed_at.toISOString(),
    };
  }

  async function querySourceFeatures(query: SpatialBoundingBoxQuery) {
    const parsed = SpatialBoundingBoxQuerySchema.parse(query);
    const kinds = parsed.featureKinds ?? [];
    const rows = kinds.length
      ? await database.client<
          Array<{
            source_feature_id: string;
            dataset_key: string;
            provider_feature_id: string;
            feature_kind: string;
            geometry: Record<string, unknown>;
            properties: Record<string, unknown>;
            source_hash: string;
          }>
        >`
          SELECT feature.source_feature_id, dataset.dataset_key,
                 feature.provider_feature_id, feature.feature_kind,
                 feature.geometry, feature.properties, feature.source_hash
          FROM source_geo.features feature
          JOIN source_geo.datasets dataset ON dataset.dataset_id = feature.dataset_id
          WHERE feature.active = true
            AND feature.max_longitude >= ${parsed.minLongitude}
            AND feature.min_longitude <= ${parsed.maxLongitude}
            AND feature.max_latitude >= ${parsed.minLatitude}
            AND feature.min_latitude <= ${parsed.maxLatitude}
            AND feature.feature_kind = ANY(${kinds})
          ORDER BY feature.dataset_id, feature.provider_feature_id
          LIMIT ${parsed.limit}
        `
      : await database.client<
          Array<{
            source_feature_id: string;
            dataset_key: string;
            provider_feature_id: string;
            feature_kind: string;
            geometry: Record<string, unknown>;
            properties: Record<string, unknown>;
            source_hash: string;
          }>
        >`
          SELECT feature.source_feature_id, dataset.dataset_key,
                 feature.provider_feature_id, feature.feature_kind,
                 feature.geometry, feature.properties, feature.source_hash
          FROM source_geo.features feature
          JOIN source_geo.datasets dataset ON dataset.dataset_id = feature.dataset_id
          WHERE feature.active = true
            AND feature.max_longitude >= ${parsed.minLongitude}
            AND feature.min_longitude <= ${parsed.maxLongitude}
            AND feature.max_latitude >= ${parsed.minLatitude}
            AND feature.min_latitude <= ${parsed.maxLatitude}
          ORDER BY feature.dataset_id, feature.provider_feature_id
          LIMIT ${parsed.limit}
        `;
    return rows;
  }

  async function createCanonicalSpatialEntity(input: CanonicalSpatialEntityInput) {
    const parsed = CanonicalSpatialEntityInputSchema.parse(input);
    const bounds = calculateSpatialBounds(parsed.geometry);
    return database.client.begin(async (transaction) => {
      const inserted = await transaction<Array<{ spatial_entity_id: string; version: number }>>`
        INSERT INTO world_geo.spatial_entities (
          world_id, shard_id, activation_cell_id, stable_key, spatial_type, name,
          parent_spatial_entity_id, geometry_type, geometry,
          min_longitude, min_latitude, max_longitude, max_latitude,
          centroid_longitude, centroid_latitude, provenance, state
        )
        VALUES (
          ${parsed.worldId}, ${parsed.shardId}, ${parsed.activationCellId ?? null},
          ${parsed.stableKey}, ${parsed.spatialType}, ${parsed.name},
          ${parsed.parentSpatialEntityId ?? null}, ${parsed.geometry.type},
          ${json(parsed.geometry)}::jsonb,
          ${bounds.minLongitude}, ${bounds.minLatitude},
          ${bounds.maxLongitude}, ${bounds.maxLatitude},
          ${bounds.centroidLongitude}, ${bounds.centroidLatitude},
          ${parsed.provenance}, ${json(parsed.state)}::jsonb
        )
        ON CONFLICT (world_id, shard_id, stable_key) DO NOTHING
        RETURNING spatial_entity_id, version
      `;

      const entity = inserted[0]
        ? { ...inserted[0], created: true as const }
        : (
            await transaction<Array<{ spatial_entity_id: string; version: number }>>`
              SELECT spatial_entity_id, version
              FROM world_geo.spatial_entities
              WHERE world_id = ${parsed.worldId}
                AND shard_id = ${parsed.shardId}
                AND stable_key = ${parsed.stableKey}
              LIMIT 1
            `
          )[0];
      if (!entity) {
        throw new GeospatialStoreError(
          "canonical_conflict",
          "Canonical spatial entity could not be created or resolved.",
        );
      }

      for (const sourceFeatureId of parsed.sourceFeatureIds) {
        await transaction`
          INSERT INTO world_geo.source_links (
            spatial_entity_id, source_feature_id, relationship,
            transformation_version, transformation_metadata
          )
          VALUES (
            ${entity.spatial_entity_id}, ${sourceFeatureId}, 'derived_from',
            ${parsed.transformationVersion},
            ${json(parsed.transformationMetadata)}::jsonb
          )
          ON CONFLICT DO NOTHING
        `;
      }

      return {
        spatialEntityId: entity.spatial_entity_id,
        version: entity.version,
        created: "created" in entity ? entity.created : false,
      };
    });
  }

  return {
    getDataset,
    startImport,
    upsertSourceFeatures,
    finishImport,
    querySourceFeatures,
    createCanonicalSpatialEntity,
  };
}
