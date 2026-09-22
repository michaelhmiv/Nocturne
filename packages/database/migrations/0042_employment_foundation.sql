-- Employment is gameplay state, never system.ai_jobs (which queues AI work).
-- All rows are explicitly world/shard scoped. No public-world defaults.
CREATE TABLE game.employment_offers (
  offer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL,
  shard_id uuid NOT NULL,
  employer_id uuid NOT NULL REFERENCES game.entity_instances(instance_id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 2 AND 160),
  wage_cents integer NOT NULL CHECK (wage_cents > 0),
  duration_seconds integer NOT NULL CHECK (duration_seconds BETWEEN 1 AND 86400),
  capacity integer NOT NULL CHECK (capacity BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (world_id, shard_id) REFERENCES game.world_shards(world_id, shard_id)
);

CREATE TABLE game.employment_positions (
  position_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL,
  shard_id uuid NOT NULL,
  offer_id uuid NOT NULL REFERENCES game.employment_offers(offer_id),
  worker_id uuid NOT NULL REFERENCES game.entity_instances(instance_id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','resigned','terminated')),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  UNIQUE (offer_id, worker_id),
  FOREIGN KEY (world_id, shard_id) REFERENCES game.world_shards(world_id, shard_id)
);

CREATE TABLE game.employment_shifts (
  shift_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL,
  shard_id uuid NOT NULL,
  position_id uuid NOT NULL REFERENCES game.employment_positions(position_id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finishes_at timestamptz NOT NULL,
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'working'
    CHECK (status IN ('working','completed','interrupted','missed')),
  CHECK (finishes_at > started_at),
  FOREIGN KEY (world_id, shard_id) REFERENCES game.world_shards(world_id, shard_id)
);
CREATE UNIQUE INDEX employment_one_working_shift_per_position
  ON game.employment_shifts(position_id) WHERE status = 'working';

CREATE TABLE game.employment_payments (
  payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id uuid NOT NULL,
  shard_id uuid NOT NULL,
  shift_id uuid NOT NULL UNIQUE REFERENCES game.employment_shifts(shift_id),
  worker_id uuid NOT NULL REFERENCES game.entity_instances(instance_id),
  employer_id uuid NOT NULL REFERENCES game.entity_instances(instance_id),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  event_id uuid NOT NULL UNIQUE REFERENCES game.event_ledger(event_id),
  paid_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (world_id, shard_id) REFERENCES game.world_shards(world_id, shard_id)
);
CREATE INDEX employment_offers_scope_idx ON game.employment_offers(world_id,shard_id,status);
CREATE INDEX employment_positions_worker_idx ON game.employment_positions(world_id,shard_id,worker_id);
CREATE INDEX employment_shifts_due_idx ON game.employment_shifts(world_id,shard_id,finishes_at)
  WHERE status = 'working';

-- FK on instance_id alone does not protect a cross-world reference.
-- Validate all referenced records while holding transaction-level row locks.
CREATE FUNCTION game.validate_employment_scope()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected_world uuid;
  expected_shard uuid;
  target_id uuid;
  linked record;
BEGIN
  IF TG_TABLE_NAME = 'employment_offers' THEN
    target_id := NEW.employer_id;
  ELSIF TG_TABLE_NAME = 'employment_positions' THEN
    SELECT world_id, shard_id, employer_id
      INTO linked FROM game.employment_offers WHERE offer_id = NEW.offer_id;
    IF NOT FOUND OR linked.world_id <> NEW.world_id OR linked.shard_id <> NEW.shard_id THEN
      RAISE EXCEPTION 'Employment offer scope mismatch' USING ERRCODE='23514';
    END IF;
    target_id := NEW.worker_id;
  ELSIF TG_TABLE_NAME = 'employment_shifts' THEN
    SELECT world_id, shard_id INTO linked
      FROM game.employment_positions WHERE position_id = NEW.position_id;
    IF NOT FOUND OR linked.world_id <> NEW.world_id OR linked.shard_id <> NEW.shard_id THEN
      RAISE EXCEPTION 'Employment position scope mismatch' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  ELSE
    SELECT shift.world_id, shift.shard_id, position.worker_id, offer.employer_id
      INTO linked
      FROM game.employment_shifts shift
      JOIN game.employment_positions position ON position.position_id = shift.position_id
      JOIN game.employment_offers offer ON offer.offer_id = position.offer_id
      WHERE shift.shift_id = NEW.shift_id;
    IF NOT FOUND OR linked.world_id <> NEW.world_id OR linked.shard_id <> NEW.shard_id
       OR linked.worker_id <> NEW.worker_id OR linked.employer_id <> NEW.employer_id
       OR NOT EXISTS (
         SELECT 1 FROM game.event_ledger event
          WHERE event.event_id = NEW.event_id AND event.world_id = NEW.world_id
            AND event.shard_id = NEW.shard_id
       ) THEN
      RAISE EXCEPTION 'Employment payment scope mismatch' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  SELECT world_id, shard_id INTO expected_world, expected_shard
    FROM game.entity_instances WHERE instance_id = target_id;
  IF NOT FOUND OR expected_world IS DISTINCT FROM NEW.world_id
    OR expected_shard IS DISTINCT FROM NEW.shard_id THEN
    RAISE EXCEPTION 'Employment entity scope mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER employment_offers_scope BEFORE INSERT OR UPDATE ON game.employment_offers
  FOR EACH ROW EXECUTE FUNCTION game.validate_employment_scope();
CREATE TRIGGER employment_positions_scope BEFORE INSERT OR UPDATE ON game.employment_positions
  FOR EACH ROW EXECUTE FUNCTION game.validate_employment_scope();
CREATE TRIGGER employment_shifts_scope BEFORE INSERT OR UPDATE ON game.employment_shifts
  FOR EACH ROW EXECUTE FUNCTION game.validate_employment_scope();
CREATE TRIGGER employment_payments_scope BEFORE INSERT OR UPDATE ON game.employment_payments
  FOR EACH ROW EXECUTE FUNCTION game.validate_employment_scope();
