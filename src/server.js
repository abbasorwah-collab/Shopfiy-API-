import express from "express";
import { shopifyGraphQL } from "./shopify.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// GET /shop - basic store info
app.get("/shop", async (_req, res, next) => {
  try {
    const data = await shopifyGraphQL(`{ shop { name myshopifyDomain currencyCode } }`);
    res.json(data.shop);
  } catch (err) {
    next(err);
  }
});

// GET /products?first=10&after=CURSOR
app.get("/products", async (req, res, next) => {
  try {
    const first = Math.min(Number(req.query.first) || 10, 50);
    const after = req.query.after || null;
    const data = await shopifyGraphQL(
      `query Products($first: Int!, $after: String) {
        products(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { id title handle status totalInventory }
        }
      }`,
      { first, after }
    );
    res.json(data.products);
  } catch (err) {
    next(err);
  }
});

// GET /orders?first=10
app.get("/orders", async (req, res, next) => {
  try {
    const first = Math.min(Number(req.query.first) || 10, 50);
    const data = await shopifyGraphQL(
      `query Orders($first: Int!) {
        orders(first: $first, sortKey: CREATED_AT, reverse: true) {
          nodes {
            id name createdAt displayFinancialStatus displayFulfillmentStatus
            totalPriceSet { shopMoney { amount currencyCode } }
          }
        }
      }`,
      { first }
    );
    res.json(data.orders.nodes);
  } catch (err) {
    next(err);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Listening on http://localhost:${port}`));
