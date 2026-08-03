# Nocturne Geospatial Importer

One-shot service for importing versioned public geospatial sources into `source_geo`.

Required environment:

- `DATABASE_URL`

Defaults:

- `GEOSPATIAL_DATASET_KEY=nyc_mappluto_public_2026`
- `GEOSPATIAL_WHERE=1=1`
- `GEOSPATIAL_PAGE_SIZE=2000`
- `GEOSPATIAL_START_OFFSET=0`
- `GEOSPATIAL_REQUEST_TIMEOUT_MS=60000`

Optional controls:

- `GEOSPATIAL_MAX_FEATURES` limits a smoke or staged import.
- `GEOSPATIAL_SOURCE_URL` overrides the registered source URL.
- `GEOSPATIAL_SOURCE_VERSION` overrides the registered source version.
- `GEOSPATIAL_OUT_FIELDS` selects comma-separated ArcGIS fields.

The importer is retry-safe at the source-feature boundary. It validates source geometry, upserts by dataset and provider feature ID, records import counts and checksums, and exits after completion. It does not create canonical Nocturne parcels or copy real owner identity into gameplay state.
