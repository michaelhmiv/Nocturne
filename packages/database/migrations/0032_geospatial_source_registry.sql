-- Versioned source geography and independent canonical Nocturne geometry.
--
-- The current Railway database uses the standard PostgreSQL image rather than a
-- PostGIS image. Geometry is therefore stored as validated GeoJSON with explicit
-- WGS84 bounds and centroids. This keeps imports reproducible and gameplay state
-- independent while permitting a future online PostGIS backfill without changing
-- stable world IDs.

CREATE SCHEMA IF NOT EXISTS source_geo;
CREATE SCHEMA IF NOT EXISTS world_geo;

CREATE TABLE IF NOT EXISTS source_geo.datasets (
  dataset_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_key text NOT NULL UNIQUE,
  provider text NOT NULL,
  title text NOT NULL,
  source_url text NOT NULL,
  license_name text,
  attribution_text text,
  source_version text NOT NULL,
  source_updated_at timestamptz,
  geometry_crs text NOT NULL DEFAULT 'EPSG:4326',
  feature_kind text NOT NULL,
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_geo_datasets_configuration_object_check
    CHECK (jsonb_typeof(configuration) = 'object'),
  CONSTRAINT source_geo_datasets_feature_kind_check
    CHECK (feature_kind IN ('parcel', 'building', 'road', 'path', 'district', 'poi', 'shoreline'))
);

CREATE TABLE IF NOT EXISTS source_geo.import_runs (
  import_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES source_geo.datasets(dataset_id),
  status text NOT NULL DEFAULT 'pending',
  source_version text NOT NULL,
  request_parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  feature_count integer NOT NULL DEFAULT 0,
  inserted_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  content_checksum text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_geo_import_runs_status_check
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  CONSTRAINT source_geo_import_runs_parameters_object_check
    CHECK (jsonb_typeof(request_parameters) = 'object'),
  CONSTRAINT source_geo_import_runs_counts_nonnegative_check
    CHECK (
      feature_count >= 0 AND inserted_count >= 0 AND updated_count >= 0
      AND skipped_count >= 0 AND error_count >= 0
    )
);

CREATE INDEX IF NOT EXISTS source_geo_import_runs_dataset_idx
  ON source_geo.import_runs(dataset_id, started_at DESC);
CREATE INDEX IF NOT EXISTS source_geo_import_runs_status_idx
  ON source_geo.import_runs(status, started_at);

CREATE TABLE IF NOT EXISTS source_geo.features (
  source_feature_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dataset_id uuid NOT NULL REFERENCES source_geo.datasets(dataset_id),
  import_run_id uuid NOT NULL REFERENCES source_geo.import_runs(import_run_id),
  provider_feature_id text NOT NULL,
  feature_kind text NOT NULL,
  geometry_type text NOT NULL,
  geometry jsonb NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  min_longitude double precision NOT NULL,
  min_latitude double precision NOT NULL,
  max_longitude double precision NOT NULL,
  max_latitude double precision NOT NULL,
  centroid_longitude double precision NOT NULL,
  centroid_latitude double precision NOT NULL,
  source_hash text NOT NULL,
  source_updated_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  superseded_by_source_feature_id uuid REFERENCES source_geo.features(source_feature_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT source_geo_features_dataset_provider_uq
    UNIQUE (dataset_id, provider_feature_id),
  CONSTRAINT source_geo_features_kind_check
    CHECK (feature_kind IN ('parcel', 'building', 'road', 'path', 'district', 'poi', 'shoreline')),
  CONSTRAINT source_geo_features_geometry_type_check
    CHECK (geometry_type IN ('Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon')),
  CONSTRAINT source_geo_features_geometry_object_check
    CHECK (jsonb_typeof(geometry) = 'object'),
  CONSTRAINT source_geo_features_properties_object_check
    CHECK (jsonb_typeof(properties) = 'object'),
  CONSTRAINT source_geo_features_longitude_check
    CHECK (
      min_longitude BETWEEN -180 AND 180
      AND max_longitude BETWEEN -180 AND 180
      AND centroid_longitude BETWEEN -180 AND 180
      AND min_longitude <= max_longitude
    ),
  CONSTRAINT source_geo_features_latitude_check
    CHECK (
      min_latitude BETWEEN -90 AND 90
      AND max_latitude BETWEEN -90 AND 90
      AND centroid_latitude BETWEEN -90 AND 90
      AND min_latitude <= max_latitude
    )
);

CREATE INDEX IF NOT EXISTS source_geo_features_dataset_kind_idx
  ON source_geo.features(dataset_id, feature_kind, active);
CREATE INDEX IF NOT EXISTS source_geo_features_bbox_lon_idx
  ON source_geo.features(min_longitude, max_longitude);
CREATE INDEX IF NOT EXISTS source_geo_features_bbox_lat_idx
  ON source_geo.features(min_latitude, max_latitude);
CREATE INDEX IF NOT EXISTS source_geo_features_centroid_idx
  ON source_geo.features(centroid_longitude, centroid_latitude);
CREATE INDEX IF NOT EXISTS source_geo_features_source_hash_idx
  ON source_geo.features(source_hash);

CREATE TABLE IF NOT EXISTS world_geo.activation_cells (
  activation_cell_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL,
  shard_id uuid NOT NULL,
  cell_key text NOT NULL,
  status text NOT NULL DEFAULT 'source_available',
  min_longitude double precision NOT NULL,
  min_latitude double precision NOT NULL,
  max_longitude double precision NOT NULL,
  max_latitude double precision NOT NULL,
  seed_version text NOT NULL,
  activation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT world_geo_activation_cells_world_key_uq
    UNIQUE (world_id, shard_id, cell_key),
  CONSTRAINT world_geo_activation_cells_status_check
    CHECK (status IN ('source_available', 'compiling', 'active', 'failed', 'archived')),
  CONSTRAINT world_geo_activation_cells_bounds_check
    CHECK (
      min_longitude BETWEEN -180 AND 180 AND max_longitude BETWEEN -180 AND 180
      AND min_latitude BETWEEN -90 AND 90 AND max_latitude BETWEEN -90 AND 90
      AND min_longitude <= max_longitude AND min_latitude <= max_latitude
    ),
  CONSTRAINT world_geo_activation_cells_metadata_object_check
    CHECK (jsonb_typeof(activation_metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS world_geo_activation_cells_status_idx
  ON world_geo.activation_cells(world_id, shard_id, status);

CREATE TABLE IF NOT EXISTS world_geo.spatial_entities (
  spatial_entity_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL,
  shard_id uuid NOT NULL,
  activation_cell_id uuid REFERENCES world_geo.activation_cells(activation_cell_id),
  stable_key text NOT NULL,
  spatial_type text NOT NULL,
  name text NOT NULL,
  parent_spatial_entity_id uuid REFERENCES world_geo.spatial_entities(spatial_entity_id),
  geometry_type text NOT NULL,
  geometry jsonb NOT NULL,
  min_longitude double precision NOT NULL,
  min_latitude double precision NOT NULL,
  max_longitude double precision NOT NULL,
  max_latitude double precision NOT NULL,
  centroid_longitude double precision NOT NULL,
  centroid_latitude double precision NOT NULL,
  lifecycle_status text NOT NULL DEFAULT 'active',
  provenance text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT world_geo_spatial_entities_world_key_uq
    UNIQUE (world_id, shard_id, stable_key),
  CONSTRAINT world_geo_spatial_entities_type_check
    CHECK (spatial_type IN ('district', 'parcel', 'building', 'street', 'path', 'poi', 'shoreline')),
  CONSTRAINT world_geo_spatial_entities_geometry_type_check
    CHECK (geometry_type IN ('Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon')),
  CONSTRAINT world_geo_spatial_entities_geometry_object_check
    CHECK (jsonb_typeof(geometry) = 'object'),
  CONSTRAINT world_geo_spatial_entities_bounds_check
    CHECK (
      min_longitude BETWEEN -180 AND 180 AND max_longitude BETWEEN -180 AND 180
      AND centroid_longitude BETWEEN -180 AND 180
      AND min_latitude BETWEEN -90 AND 90 AND max_latitude BETWEEN -90 AND 90
      AND centroid_latitude BETWEEN -90 AND 90
      AND min_longitude <= max_longitude AND min_latitude <= max_latitude
    ),
  CONSTRAINT world_geo_spatial_entities_lifecycle_check
    CHECK (lifecycle_status IN ('active', 'historical', 'demolished', 'merged', 'subdivided', 'archived')),
  CONSTRAINT world_geo_spatial_entities_provenance_check
    CHECK (provenance IN ('seeded', 'template_instantiated', 'ai_proposed', 'player_created', 'operator_authored', 'derived')),
  CONSTRAINT world_geo_spatial_entities_version_positive_check
    CHECK (version > 0),
  CONSTRAINT world_geo_spatial_entities_state_object_check
    CHECK (jsonb_typeof(state) = 'object')
);

CREATE INDEX IF NOT EXISTS world_geo_spatial_entities_type_idx
  ON world_geo.spatial_entities(world_id, shard_id, spatial_type, lifecycle_status);
CREATE INDEX IF NOT EXISTS world_geo_spatial_entities_parent_idx
  ON world_geo.spatial_entities(parent_spatial_entity_id);
CREATE INDEX IF NOT EXISTS world_geo_spatial_entities_bbox_lon_idx
  ON world_geo.spatial_entities(min_longitude, max_longitude);
CREATE INDEX IF NOT EXISTS world_geo_spatial_entities_bbox_lat_idx
  ON world_geo.spatial_entities(min_latitude, max_latitude);
CREATE INDEX IF NOT EXISTS world_geo_spatial_entities_centroid_idx
  ON world_geo.spatial_entities(centroid_longitude, centroid_latitude);

CREATE TABLE IF NOT EXISTS world_geo.source_links (
  spatial_entity_id uuid NOT NULL REFERENCES world_geo.spatial_entities(spatial_entity_id) ON DELETE CASCADE,
  source_feature_id uuid NOT NULL REFERENCES source_geo.features(source_feature_id),
  relationship text NOT NULL DEFAULT 'derived_from',
  transformation_version text NOT NULL,
  transformation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (spatial_entity_id, source_feature_id, relationship),
  CONSTRAINT world_geo_source_links_relationship_check
    CHECK (relationship IN ('derived_from', 'aligned_with', 'seeded_by', 'supersedes_source')),
  CONSTRAINT world_geo_source_links_metadata_object_check
    CHECK (jsonb_typeof(transformation_metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS world_geo_source_links_source_idx
  ON world_geo.source_links(source_feature_id);

CREATE TABLE IF NOT EXISTS world_geo.lineage (
  predecessor_spatial_entity_id uuid NOT NULL REFERENCES world_geo.spatial_entities(spatial_entity_id),
  successor_spatial_entity_id uuid NOT NULL REFERENCES world_geo.spatial_entities(spatial_entity_id),
  lineage_type text NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT now(),
  event_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (predecessor_spatial_entity_id, successor_spatial_entity_id, lineage_type),
  CONSTRAINT world_geo_lineage_distinct_entities_check
    CHECK (predecessor_spatial_entity_id <> successor_spatial_entity_id),
  CONSTRAINT world_geo_lineage_type_check
    CHECK (lineage_type IN ('subdivided_into', 'merged_into', 'replaced_by', 'renamed_as', 'boundary_adjusted_to')),
  CONSTRAINT world_geo_lineage_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object')
);

INSERT INTO source_geo.datasets (
  dataset_key,
  provider,
  title,
  source_url,
  license_name,
  attribution_text,
  source_version,
  source_updated_at,
  feature_kind,
  configuration
)
VALUES
  (
    'nyc_pluto_26v1',
    'NYC Department of City Planning',
    'Primary Land Use Tax Lot Output (PLUTO)',
    'https://data.cityofnewyork.us/resource/64uk-42ks.json',
    'NYC Open Data Terms of Use',
    'NYC Department of City Planning',
    '26v1',
    '2026-05-28T23:50:48Z',
    'parcel',
    '{"dataset_id":"64uk-42ks","role":"attributes","geometry_source":"mappluto_arcgis"}'::jsonb
  ),
  (
    'nyc_mappluto_public_2026',
    'NYC Department of City Planning',
    'MapPLUTO Public Tax Lot Polygons',
    'https://services5.arcgis.com/QygLi7lRn9WflKMX/arcgis/rest/services/MapPLUTO_Public/FeatureServer/0',
    'NYC Open Data Terms of Use',
    'NYC Department of City Planning',
    '2026',
    NULL,
    'parcel',
    '{"service_item_id":"721c8122c5f64f11a31c11f0566048d0","max_record_count":2000,"role":"geometry"}'::jsonb
  ),
  (
    'nyc_building_footprints_2026_07_27',
    'NYC Office of Technology and Innovation',
    'NYC Building Footprints',
    'https://data.cityofnewyork.us/resource/3g6p-4u5s.json',
    'NYC Open Data Terms of Use',
    'NYC Office of Technology and Innovation',
    '2026-07-27',
    '2026-07-27T00:00:00Z',
    'building',
    '{"dataset_id":"3g6p-4u5s","role":"geometry_and_attributes"}'::jsonb
  ),
  (
    'nyc_nta_26b',
    'NYC Department of City Planning',
    '2020 Neighborhood Tabulation Areas',
    'https://www.nyc.gov/content/planning/pages/resources/datasets/neighborhood-tabulation',
    'NYC Open Data Terms of Use',
    'NYC Department of City Planning',
    '26B',
    '2026-05-01T00:00:00Z',
    'district',
    '{"role":"approximate_neighborhood_seed","authoritative_boundary":false}'::jsonb
  ),
  (
    'openstreetmap_nyc_seed',
    'OpenStreetMap contributors',
    'OpenStreetMap NYC Roads and Points of Interest',
    'https://www.openstreetmap.org',
    'Open Data Commons Open Database License 1.0',
    '© OpenStreetMap contributors',
    'unimported',
    NULL,
    'road',
    '{"role":"roads_paths_entrances_and_pois","bulk_extract_required":true,"live_tile_dependency":false}'::jsonb
  )
ON CONFLICT (dataset_key) DO UPDATE SET
  provider = EXCLUDED.provider,
  title = EXCLUDED.title,
  source_url = EXCLUDED.source_url,
  license_name = EXCLUDED.license_name,
  attribution_text = EXCLUDED.attribution_text,
  source_version = EXCLUDED.source_version,
  source_updated_at = EXCLUDED.source_updated_at,
  feature_kind = EXCLUDED.feature_kind,
  configuration = EXCLUDED.configuration,
  active = true,
  updated_at = now();
