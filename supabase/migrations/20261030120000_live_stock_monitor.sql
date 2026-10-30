/*
# Live stock monitor

Adds the columns the automatic stock check needs so Shopify stock never silently drifts from Ingram Micro.

1. products
- `shopify_stock_pushed`: the stock quantity last confirmed in Shopify. Compared with Ingram's current stock to decide whether Shopify needs updating.
- `stock_checked_at`: when this product's stock was last verified. The checker always works through the oldest first.
- `stock_error`: why the last check or Shopify update failed (null when fine).

2. sync_settings
- `stock_sync_last_run_at` and `stock_sync_last_result`: shown on the dashboard so you can see the monitor is alive.

3. Notes
- Existing grants already cover the new columns (table-level SELECT for the app, service role for the edge function).
- Re-running this migration is safe: every statement is idempotent.
*/

ALTER TABLE products ADD COLUMN IF NOT EXISTS shopify_stock_pushed integer;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_checked_at timestamptz;
ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_error text;

ALTER TABLE sync_settings ADD COLUMN IF NOT EXISTS stock_sync_last_run_at timestamptz;
ALTER TABLE sync_settings ADD COLUMN IF NOT EXISTS stock_sync_last_result text;

CREATE INDEX IF NOT EXISTS products_stock_check_idx
  ON products (stock_checked_at NULLS FIRST)
  WHERE shopify_inventory_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS products_stock_error_idx
  ON products (id)
  WHERE stock_error IS NOT NULL;
