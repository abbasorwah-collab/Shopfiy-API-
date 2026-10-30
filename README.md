# Shopify API

A small Express service that wraps the Shopify Admin GraphQL API.

## Setup

1. In Shopify admin, create a custom app and grant it read access to products and orders.
2. Copy its Admin API access token.
3. `cp .env.example .env` and fill in `SHOPIFY_STORE_DOMAIN` and `SHOPIFY_ADMIN_TOKEN`.
4. `npm install && npm start`

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Liveness check |
| GET | `/shop` | Store name, domain, currency |
| GET | `/products?first=10&after=CURSOR` | Paginated products |
| GET | `/orders?first=10` | Most recent orders |

Never commit `.env`; it is git-ignored.
