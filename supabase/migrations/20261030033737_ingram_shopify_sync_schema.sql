/*
# Ingram Micro to Shopify sync schema

Creates the tables that hold the vendor list, the Ingram Micro product catalog cache, and the sync settings used to push selected products to Shopify.

1. New Tables
- `sync_settings`: single-row table (id = 1) with Ingram Micro customer number, country code, sender ID, price markup percent, Shopify shop domain and Shopify location ID.
- `vendors`: manufacturers to sync (for example HP, Lenovo, Zebra, Xerox). Tracks whether the vendor is enabled, when its catalog and pricing were last synced, and the most recent error.
- `products`: cached Ingram Micro products with description, category, cost, MSRP, MAP, stock by warehouse, the `is_selected` flag that marks a product for Shopify, and the Shopify IDs and sync status once pushed.

2. Security
- Row level security is enabled on all three tables.
- The app has no sign-in, so the anon and authenticated roles are granted the verbs the UI needs. Column-level grants limit what the browser can change: vendors can only be inserted with name and enabled and only `enabled` can be updated; products can only have `is_selected` updated.
- All Ingram Micro and Shopify API calls, and all catalog and pricing writes, happen inside edge functions using the service role.

3. Important notes
- Sync settings are seeded with one row so the settings screen always has something to read.
- Indexes support filtering products by vendor, by selection, and by pending pricing refreshes.
- Re-running this migration is safe: every statement is idempotent.
*/

CREATE TABLE IF NOT EXISTS sync_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ingram_customer_number text NOT NULL DEFAULT '',
  ingram_country_code text NOT NULL DEFAULT 'US',
  ingram_sender_id text NOT NULL DEFAULT 'ShopifySync',
  markup_percent numeric(6,2) NOT NULL DEFAULT 0,
  shopify_shop_domain text NOT NULL DEFAULT '',
  shopify_location_id text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO sync_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  last_catalog_synced_at timestamptz,
  last_pricing_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ingram_part_number text NOT NULL UNIQUE,
  vendor_name text NOT NULL REFERENCES vendors(name) ON UPDATE CASCADE ON DELETE CASCADE,
  vendor_part_number text,
  upc text,
  description text,
  category text,
  sub_category text,
  is_selected boolean NOT NULL DEFAULT false,
  customer_cost numeric(12,2),
  msrp numeric(12,2),
  map_price numeric(12,2),
  currency text,
  total_availability integer,
  availability_by_warehouse jsonb NOT NULL DEFAULT '[]'::jsonb,
  catalog_synced_at timestamptz,
  pricing_updated_at timestamptz,
  shopify_product_id bigint,
  shopify_variant_id bigint,
  shopify_inventory_item_id bigint,
  shopify_synced_at timestamptz,
  shopify_error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_vendor_name_idx ON products (vendor_name);
CREATE INDEX IF NOT EXISTS products_selected_idx ON products (vendor_name) WHERE is_selected;
CREATE INDEX IF NOT EXISTS products_pricing_pending_idx ON products (vendor_name) WHERE pricing_updated_at IS NULL;

ALTER TABLE sync_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON sync_settings, vendors, products FROM anon, authenticated;

GRANT SELECT, UPDATE ON sync_settings TO anon, authenticated;
GRANT SELECT ON vendors TO anon, authenticated;
GRANT INSERT (name, enabled) ON vendors TO anon, authenticated;
GRANT UPDATE (enabled) ON vendors TO anon, authenticated;
GRANT SELECT ON products TO anon, authenticated;
GRANT UPDATE (is_selected) ON products TO anon, authenticated;

GRANT ALL ON sync_settings, vendors, products TO service_role;

DROP POLICY IF EXISTS "anon_select_sync_settings" ON sync_settings;
CREATE POLICY "anon_select_sync_settings" ON sync_settings FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_update_sync_settings" ON sync_settings;
CREATE POLICY "anon_update_sync_settings" ON sync_settings FOR UPDATE
  TO anon, authenticated USING (id = 1) WITH CHECK (id = 1);

DROP POLICY IF EXISTS "anon_select_vendors" ON vendors;
CREATE POLICY "anon_select_vendors" ON vendors FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_vendors" ON vendors;
CREATE POLICY "anon_insert_vendors" ON vendors FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_vendors" ON vendors;
CREATE POLICY "anon_update_vendors" ON vendors FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_select_products" ON products;
CREATE POLICY "anon_select_products" ON products FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_update_products" ON products;
CREATE POLICY "anon_update_products" ON products FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);
