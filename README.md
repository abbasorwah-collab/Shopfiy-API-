# Shopify API

An Express service that wraps the Shopify Admin GraphQL API and keeps a live view of product stock.

## Setup

1. In Shopify admin, create a custom app with the scopes `read_products`, `read_inventory` and `read_orders`.
2. Copy its Admin API access token and its client secret.
3. `cp .env.example .env` and fill in `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_ADMIN_TOKEN` and `SHOPIFY_WEBHOOK_SECRET`.
4. `npm install && npm start`
5. Open `http://localhost:3000` for the live dashboard.

## Keeping availability accurate

Three layers work together, so one failing never leaves the data silently stale:

1. **Webhooks (instant).** Shopify pushes `inventory_levels/update`, `products/update` and `orders/create` to `POST /webhooks/shopify`. Signatures are verified with HMAC. Register them once the service has a public https address:
   `PUBLIC_URL=https://your-host npm run register-webhooks`
2. **Polling (safety net).** Every `POLL_INTERVAL_SECONDS` (default 60) the whole catalog is re-synced, which catches any webhook that was delayed or dropped.
3. **Live check (at the moment of sale).** `GET /availability/check?ids=...` bypasses the cache and asks Shopify directly. Call this before promising an item to a customer.

Shopify itself remains the source of truth. For guaranteed no-overselling, Shopify's checkout enforces inventory too.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Live dashboard (sortable, filterable, updates in real time) |
| GET | `/health` | Liveness check |
| GET | `/shop` | Store name, domain, currency |
| GET | `/products?sort=stock&order=asc\|desc&first=10&after=CURSOR` | Products sorted by total stock, paginated by Shopify |
| GET | `/inventory?sort=stock\|name&order=asc\|desc&filter=out_of_stock\|low\|in_stock` | Per-variant stock from the synced cache |
| GET | `/availability/check?ids=123,456` | Live per-variant check straight from Shopify |
| GET | `/events` | Server-Sent Events stream of inventory changes |
| GET | `/orders?first=10` | Most recent orders |

## Notes

- Webhooks need a public https URL. For local testing use a tunnel (for example `cloudflared` or `ngrok`); polling still works without one.
- Variants whose inventory isn't tracked in Shopify show a quantity of `—` and sort last.
- Only the first 30 variants per product are tracked; a warning is logged if a product has more.
- Never commit `.env`; it is git-ignored.
