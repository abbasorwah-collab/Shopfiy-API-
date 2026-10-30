import express from "express";
import { shopifyGraphQL } from "./shopify.js";
import { bus, getInventory, scheduleRefresh, startPolling } from "./inventory.js";
import { verifyWebhook } from "./webhooks.js";

const app = express();

// Webhook route must come BEFORE express.json(): the HMAC is computed over the raw bytes.
app.post("/webhooks/shopify", express.raw({ type: "*/*" }), (req, res) => {
  if (!verifyWebhook(req.body, req.get("X-Shopify-Hmac-Sha256"))) return res.sendStatus(401);
  scheduleRefresh(500);
  res.sendStatus(200);
});

app.use(express.json());
app.use(express.static(new URL("../public", import.meta.url).pathname));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/shop", async (_req, res, next) => {
  try {
    const data = await shopifyGraphQL(`{ shop { name myshopifyDomain currencyCode } }`);
    res.json(data.shop);
  } catch (err) {
    next(err);
  }
});

// GET /products?first=10&after=CURSOR&sort=stock&order=asc|desc
// sort=stock uses Shopify's own INVENTORY_TOTAL ordering, so pagination stays correct.
app.get("/products", async (req, res, next) => {
  try {
    const first = Math.min(Number(req.query.first) || 10, 50);
    const after = req.query.after || null;
    const sortKey = req.query.sort === "stock" ? "INVENTORY_TOTAL" : "TITLE";
    const reverse = req.query.order === "desc";
    const data = await shopifyGraphQL(
      `query Products($first: Int!, $after: String, $sortKey: ProductSortKeys!, $reverse: Boolean!) {
        products(first: $first, after: $after, sortKey: $sortKey, reverse: $reverse) {
          pageInfo { hasNextPage endCursor }
          nodes { id title handle status totalInventory }
        }
      }`,
      { first, after, sortKey, reverse }
    );
    res.json(data.products);
  } catch (err) {
    next(err);
  }
});

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

// GET /inventory?sort=stock|name&order=asc|desc&filter=out_of_stock|low|in_stock
// Per-variant stock from the live-synced cache.
app.get("/inventory", (req, res) => {
  res.json(getInventory({ sort: req.query.sort, order: req.query.order, filter: req.query.filter }));
});

// GET /availability/check?ids=123,456  (variant ids, numeric or gid)
// Bypasses the cache and asks Shopify directly. Use this at the moment of sale.
app.get("/availability/check", async (req, res, next) => {
  try {
    const ids = String(req.query.ids || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((id) => (id.startsWith("gid://") ? id : `gid://shopify/ProductVariant/${id}`));
    if (!ids.length || ids.length > 50) {
      return res.status(400).json({ error: "Provide 1-50 variant ids in ?ids=" });
    }
    const data = await shopifyGraphQL(
      `query Check($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on ProductVariant {
            id title sku inventoryQuantity availableForSale
            product { title handle }
          }
        }
      }`,
      { ids }
    );
    res.json({
      checkedAt: new Date().toISOString(),
      items: data.nodes.map((n, i) => (n ? { ...n, available: n.availableForSale } : { id: ids[i], error: "not found" })),
    });
  } catch (err) {
    next(err);
  }
});

// Server-Sent Events: pushes a snapshot on connect, then an update on every change.
app.get("/events", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  send("snapshot", getInventory());
  const onUpdate = ({ changes }) => send("update", { ...getInventory(), changes });
  bus.on("update", onUpdate);
  const keepAlive = setInterval(() => res.write(": ping\n\n"), 25000);

  req.on("close", () => {
    bus.off("update", onUpdate);
    clearInterval(keepAlive);
  });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Listening on http://localhost:${port}`);
  // Safety net: webhooks give instant updates, polling reconciles anything missed.
  startPolling(Number(process.env.POLL_INTERVAL_SECONDS || 60) * 1000);
});
