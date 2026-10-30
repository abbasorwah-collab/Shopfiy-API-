# Live stock monitor

Keeps Shopify stock in step with Ingram Micro so a product Ingram has run out of stops being sellable.

## What was added

| File | Purpose |
|------|---------|
| `supabase/migrations/20261030120000_live_stock_monitor.sql` | New columns: `shopify_stock_pushed`, `stock_checked_at`, `stock_error`, plus last-run info |
| `supabase/functions/stock-sync/index.ts` | Checks Ingram stock for every product live in Shopify and sets Shopify when it differs |
| `src/components/StockMonitor.tsx` | Dashboard panel: counts, lowest-stock-first list, "Check now", auto-check every 2 minutes |
| `src/lib/syncRunner.ts` | `runStockSync()` |
| `src/views/ProductsView.tsx` | Sort by stock (lowest or highest first) |
| `src/components/ProductTable.tsx` | Red zero stock, "checked at" time, per-product error |

## How it protects you

- Works on every product that is live in Shopify, including ones you later deselected.
- If Ingram does not answer for a product, Shopify is left unchanged and the product is flagged. A missing answer is never treated as zero.
- If Shopify rejects an update, the product is flagged and retried first on the next run.
- Products with an error are retried at the start of every run; the rest are checked oldest-first, up to 150 per run.

## Deploy

1. Apply the new migration.
2. Deploy the `stock-sync` edge function (it uses the same `INGRAM_CLIENT_ID`, `INGRAM_CLIENT_SECRET` and `SHOPIFY_ACCESS_TOKEN` secrets as the other two functions).
3. Open the Dashboard. The monitor starts checking by itself.

## Checking while nobody has the dashboard open

The dashboard checks every 2 minutes while it is open. To check around the clock, schedule the function:
Supabase Dashboard > Integrations > Cron > create a job that invokes the `stock-sync` Edge Function every 5 minutes.
The default request body `{}` is fine.
