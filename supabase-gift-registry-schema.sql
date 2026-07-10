-- Gift Registry schema for Supabase
-- Run this in your Supabase Dashboard → SQL Editor to create the required tables.

CREATE TABLE IF NOT EXISTS gift_events (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id          uuid NOT NULL,
  beneficiary_type         text NOT NULL CHECK (beneficiary_type IN ('SELF','CHILD','OTHER')),
  beneficiary_ref          uuid,
  beneficiary_display_name text NOT NULL,
  beneficiary_mint_number  text,
  occasion                 text NOT NULL CHECK (occasion IN ('BIRTHDAY','WEDDING','BABY','GRADUATION','FESTIVE','CUSTOM')),
  custom_occasion          text,
  title                    text NOT NULL,
  event_date               date NOT NULL,
  expiry_at                timestamptz NOT NULL,
  status                   text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','COMPLETED','EXPIRED','CANCELLED')),
  share_token              text UNIQUE,
  message                  text,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gift_events_creator ON gift_events(creator_user_id);
CREATE INDEX IF NOT EXISTS idx_gift_events_token   ON gift_events(share_token);
CREATE INDEX IF NOT EXISTS idx_gift_events_status  ON gift_events(status);

CREATE TABLE IF NOT EXISTS gift_registry_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_event_id         uuid NOT NULL REFERENCES gift_events(id) ON DELETE CASCADE,
  isin                  text NOT NULL,
  instrument_type       text NOT NULL DEFAULT 'SHARE' CHECK (instrument_type IN ('SHARE','ETF','BASKET')),
  target_quantity       int NOT NULL CHECK (target_quantity > 0),
  filled_quantity       int NOT NULL DEFAULT 0,
  reserved_quantity     int NOT NULL DEFAULT 0,
  min_tranche_quantity  int,
  price_snapshot_cents  int,
  status                text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','PARTIALLY_FILLED','FILLED','REMOVED','SUSPENDED')),
  display_order         int DEFAULT 0,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  CONSTRAINT no_oversell CHECK (filled_quantity + reserved_quantity <= target_quantity)
);

CREATE INDEX IF NOT EXISTS idx_gift_items_event ON gift_registry_items(gift_event_id);

CREATE TABLE IF NOT EXISTS gift_reservations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_item_id  uuid NOT NULL REFERENCES gift_registry_items(id),
  gifter_user_id    uuid NOT NULL,
  quantity          int NOT NULL CHECK (quantity > 0),
  expires_at        timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  status            text NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD','CONSUMED','RELEASED','EXPIRED')),
  price_lock_cents  int NOT NULL,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gift_res_item   ON gift_reservations(registry_item_id);
CREATE INDEX IF NOT EXISTS idx_gift_res_status ON gift_reservations(status, expires_at);

CREATE TABLE IF NOT EXISTS gift_contributions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_item_id      uuid NOT NULL REFERENCES gift_registry_items(id),
  gifter_user_id        uuid NOT NULL,
  gifter_email          text NOT NULL,
  quantity              int NOT NULL,
  quoted_amount_cents   int NOT NULL,
  executed_amount_cents int,
  fee_cents             int,
  status                text NOT NULL DEFAULT 'INITIATED' CHECK (status IN (
    'INITIATED','RESERVED','PAID','EXECUTING','SETTLED','REFUNDED','FAILED','RESERVATION_EXPIRED'
  )),
  reservation_id        uuid REFERENCES gift_reservations(id),
  payment_ref           text,
  order_ref             text,
  idempotency_key       text UNIQUE NOT NULL,
  gifter_message        text,
  created_at            timestamptz DEFAULT now()
);

-- v2 migration: add gifter_message for existing deployments (idempotent)
ALTER TABLE gift_contributions ADD COLUMN IF NOT EXISTS gifter_message text;

CREATE INDEX IF NOT EXISTS idx_gift_contrib_item   ON gift_contributions(registry_item_id);
CREATE INDEX IF NOT EXISTS idx_gift_contrib_gifter ON gift_contributions(gifter_user_id);

-- Tracks which authenticated users have viewed a public wishlist page (used for nudge eligibility)
CREATE TABLE IF NOT EXISTS gift_registry_views (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_id      uuid NOT NULL REFERENCES gift_events(id) ON DELETE CASCADE,
  viewer_user_id   uuid NOT NULL,
  viewed_at        timestamptz DEFAULT now(),
  UNIQUE (registry_id, viewer_user_id)
);
CREATE INDEX IF NOT EXISTS idx_gift_registry_views ON gift_registry_views(registry_id, viewer_user_id);

-- Row-Level Security
-- The server uses the Supabase SERVICE ROLE key which bypasses RLS entirely,
-- so no explicit policies are needed for backend access.
-- Enable RLS on all tables to prevent accidental direct anon/authenticated access.
ALTER TABLE gift_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_registry_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_reservations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_contributions   ENABLE ROW LEVEL SECURITY;

-- gift_events: owners can read/update their own registries; anyone can read ACTIVE/PAUSED ones (public share page)
CREATE POLICY "owner_all"   ON gift_events FOR ALL    TO authenticated USING (creator_user_id = auth.uid());
CREATE POLICY "public_read" ON gift_events FOR SELECT TO authenticated, anon
  USING (status IN ('ACTIVE','PAUSED') AND share_token IS NOT NULL);

-- gift_registry_items: readable when the parent registry is readable; writable by the registry owner
CREATE POLICY "owner_all"   ON gift_registry_items FOR ALL    TO authenticated
  USING (gift_event_id IN (SELECT id FROM gift_events WHERE creator_user_id = auth.uid()));
CREATE POLICY "public_read" ON gift_registry_items FOR SELECT TO authenticated, anon
  USING (gift_event_id IN (SELECT id FROM gift_events WHERE status IN ('ACTIVE','PAUSED') AND share_token IS NOT NULL));

-- gift_reservations: only the gifter can see/manage their own reservations
CREATE POLICY "gifter_all"  ON gift_reservations FOR ALL TO authenticated USING (gifter_user_id = auth.uid());

-- gift_contributions: gifter can see their own; registry owner can see all for their registries
CREATE POLICY "gifter_read"      ON gift_contributions FOR SELECT TO authenticated USING (gifter_user_id = auth.uid());
CREATE POLICY "owner_read"       ON gift_contributions FOR SELECT TO authenticated
  USING (registry_item_id IN (
    SELECT gri.id FROM gift_registry_items gri
    JOIN gift_events ge ON ge.id = gri.gift_event_id
    WHERE ge.creator_user_id = auth.uid()
  ));
