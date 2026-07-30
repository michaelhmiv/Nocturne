-- Phase 3: marketplace + vehicles

CREATE TABLE IF NOT EXISTS game.marketplace_listings (
  listing_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  item_instance_id uuid REFERENCES game.entity_instances(instance_id) ON DELETE SET NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'sold', 'cancelled')),
  buyer_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  sold_at timestamptz
);

CREATE INDEX IF NOT EXISTS marketplace_listings_active_idx
  ON game.marketplace_listings (status, created_at DESC)
  WHERE status = 'active';

INSERT INTO game.entity_definitions (
  definition_id, definition_type, name, concept_summary, origin_source, lifecycle_status
) VALUES (
  'vehicle', 'item', 'Vehicle', 'A drivable vehicle', 'world-seed', 'approved'
) ON CONFLICT (definition_id) DO NOTHING;

INSERT INTO game.definition_revisions (revision_id, definition_id, schema_version, payload, change_summary)
SELECT gen_random_uuid(), 'vehicle', 1, '{"speedFactor":2}'::jsonb, 'vehicle base'
WHERE NOT EXISTS (SELECT 1 FROM game.definition_revisions WHERE definition_id = 'vehicle');

UPDATE game.entity_definitions ed
SET current_revision_id = (
  SELECT revision_id FROM game.definition_revisions WHERE definition_id = 'vehicle' LIMIT 1
)
WHERE definition_id = 'vehicle' AND current_revision_id IS NULL;

-- location_id left null; claim/move can set later. Avoids FK against missing city seed.
INSERT INTO game.entity_instances (instance_id, definition_id, location_id, state)
VALUES
  (
    'b1000000-0000-4000-8000-000000000001',
    'vehicle',
    NULL,
    '{"name":"Courier Bike","speedFactor":2.5,"forSale":true,"priceCents":25000}'::jsonb
  ),
  (
    'b1000000-0000-4000-8000-000000000002',
    'vehicle',
    NULL,
    '{"name":"Used Sedan","speedFactor":1.8,"forSale":true,"priceCents":120000}'::jsonb
  )
ON CONFLICT (instance_id) DO NOTHING;
