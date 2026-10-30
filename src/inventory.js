import { EventEmitter } from "node:events";
import { shopifyGraphQL } from "./shopify.js";

export const bus = new EventEmitter();
export const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD ?? 5);

let rows = [];
let updatedAt = null;
let lastError = null;
let refreshing = false;
let queued = false;
let timer = null;

const QUERY = `query Inventory($after: String) {
  products(first: 20, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title handle status
      variants(first: 30) {
        pageInfo { hasNextPage }
        nodes { id title sku inventoryQuantity availableForSale }
      }
    }
  }
}`;

function stockStatus(r) {
  if (!r.availableForSale) return "out_of_stock";
  if (r.quantity != null && r.quantity <= LOW_STOCK_THRESHOLD) return "low";
  return "in_stock";
}

async function fetchAll() {
  const out = [];
  let after = null;
  do {
    const d = await shopifyGraphQL(QUERY, { after });
    for (const p of d.products.nodes) {
      if (p.variants.pageInfo.hasNextPage) {
        console.warn(`Product "${p.handle}" has more than 30 variants; extra variants are not tracked`);
      }
      for (const v of p.variants.nodes) {
        out.push({
          variantId: v.id,
          productId: p.id,
          product: p.title,
          handle: p.handle,
          productStatus: p.status,
          variant: v.title === "Default Title" ? null : v.title,
          sku: v.sku,
          quantity: v.inventoryQuantity, // null when inventory isn't tracked
          availableForSale: v.availableForSale,
        });
      }
    }
    after = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
  } while (after);
  return out;
}

export async function refresh() {
  if (refreshing) {
    queued = true; // run once more after the current pass so nothing is missed
    return;
  }
  refreshing = true;
  try {
    const next = await fetchAll();
    const prev = new Map(rows.map((r) => [r.variantId, r]));
    const changes = [];
    if (rows.length) {
      for (const r of next) {
        const o = prev.get(r.variantId);
        if (!o || o.quantity !== r.quantity || o.availableForSale !== r.availableForSale) {
          changes.push({ ...r, status: stockStatus(r), previousQuantity: o ? o.quantity : null });
        }
      }
    }
    rows = next.map((r) => ({ ...r, status: stockStatus(r) }));
    updatedAt = new Date().toISOString();
    lastError = null;
    bus.emit("update", { changes });
  } catch (err) {
    lastError = err.message;
    console.error("Inventory refresh failed:", err.message);
    bus.emit("update", { changes: [] });
  } finally {
    refreshing = false;
    if (queued) {
      queued = false;
      refresh();
    }
  }
}

// Debounced refresh, used by webhooks so a burst of events costs one fetch
export function scheduleRefresh(delayMs = 500) {
  clearTimeout(timer);
  timer = setTimeout(refresh, delayMs);
}

export function startPolling(intervalMs) {
  refresh();
  setInterval(refresh, intervalMs).unref();
}

export function getInventory({ sort = "stock", order = "asc", filter } = {}) {
  let items = rows;
  if (filter) items = items.filter((r) => r.status === filter);

  const dir = order === "desc" ? -1 : 1;
  const sorted = [...items].sort((a, b) => {
    if (sort === "name") return dir * a.product.localeCompare(b.product);
    // stock: untracked (null) always last
    if (a.quantity == null && b.quantity == null) return 0;
    if (a.quantity == null) return 1;
    if (b.quantity == null) return -1;
    return dir * (a.quantity - b.quantity);
  });

  return {
    updatedAt,
    lastError,
    lowStockThreshold: LOW_STOCK_THRESHOLD,
    count: sorted.length,
    items: sorted,
  };
}
