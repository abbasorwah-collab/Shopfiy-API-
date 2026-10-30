import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SHOPIFY_API_VERSION = "2025-01";
const MAX_PRODUCTS_PER_REQUEST = 10;
const DELAY_BETWEEN_PRODUCTS_MS = 500;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type Settings = {
  markup_percent: number;
  shopify_shop_domain: string;
  shopify_location_id: string;
};

type Product = {
  id: string;
  ingram_part_number: string;
  vendor_name: string;
  vendor_part_number: string | null;
  upc: string | null;
  description: string | null;
  category: string | null;
  customer_cost: number | null;
  msrp: number | null;
  total_availability: number | null;
  shopify_product_id: number | null;
  shopify_variant_id: number | null;
  shopify_inventory_item_id: number | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadSettings(): Promise<Settings> {
  const { data, error } = await supabase
    .from("sync_settings")
    .select("markup_percent, shopify_shop_domain, shopify_location_id")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`Could not load settings: ${error.message}`);
  if (!data) throw new Error("Sync settings are missing");
  if (!data.shopify_shop_domain) {
    throw new Error("Enter your Shopify store domain in Settings first");
  }
  return { ...data, markup_percent: Number(data.markup_percent) } as Settings;
}

function getShopifyToken(): string {
  const token = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  if (!token) throw new Error("Shopify access token is not configured");
  return token;
}

async function shopifyRequest(
  settings: Settings,
  token: string,
  method: "GET" | "POST" | "PUT",
  path: string,
  payload?: unknown,
) {
  const res = await fetch(
    `https://${settings.shopify_shop_domain}/admin/api/${SHOPIFY_API_VERSION}${path}`,
    {
      method,
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: payload ? JSON.stringify(payload) : undefined,
    },
  );
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

function shopifyErrorMessage(status: number, data: any): string {
  const errors = data?.errors;
  const detail = typeof errors === "string" ? errors : errors ? JSON.stringify(errors) : "no details";
  return `Shopify request failed (${status}): ${detail}`;
}

function sellingPrice(cost: number, markupPercent: number): number {
  return Math.round(cost * (1 + markupPercent / 100) * 100) / 100;
}

async function pushProduct(product: Product, settings: Settings, token: string) {
  if (product.customer_cost === null || product.customer_cost === undefined) {
    throw new Error("No Ingram price yet. Refresh pricing for this vendor first.");
  }

  const price = sellingPrice(Number(product.customer_cost), settings.markup_percent);
  const msrp = product.msrp === null ? null : Number(product.msrp);
  const compareAtPrice = msrp !== null && msrp > price ? msrp.toFixed(2) : null;
  const title = (product.description ?? product.ingram_part_number).slice(0, 255);
  const bodyHtml = [
    `<p>${escapeHtml(product.description ?? title)}</p>`,
    product.vendor_part_number
      ? `<p>Manufacturer part number: ${escapeHtml(product.vendor_part_number)}</p>`
      : "",
  ].join("");

  const variantFields = {
    sku: product.ingram_part_number,
    barcode: product.upc || undefined,
    price: price.toFixed(2),
    compare_at_price: compareAtPrice,
    inventory_management: "shopify",
    inventory_policy: "deny",
  };
  const productFields = {
    title,
    body_html: bodyHtml,
    vendor: product.vendor_name,
    product_type: product.category || undefined,
    tags: ["ingram-micro", product.vendor_name],
  };

  let shopifyProduct: any = null;

  if (product.shopify_product_id) {
    const update = await shopifyRequest(settings, token, "PUT", `/products/${product.shopify_product_id}.json`, {
      product: {
        id: product.shopify_product_id,
        ...productFields,
        variants: [
          { ...variantFields, ...(product.shopify_variant_id ? { id: product.shopify_variant_id } : {}) },
        ],
      },
    });
    if (update.ok) {
      shopifyProduct = update.data?.product;
    } else if (update.status !== 404) {
      throw new Error(shopifyErrorMessage(update.status, update.data));
    }
  }

  if (!shopifyProduct) {
    const create = await shopifyRequest(settings, token, "POST", "/products.json", {
      product: { ...productFields, status: "active", variants: [variantFields] },
    });
    if (!create.ok) throw new Error(shopifyErrorMessage(create.status, create.data));
    shopifyProduct = create.data?.product;
  }

  const variant = shopifyProduct?.variants?.[0];
  const inventoryItemId = variant?.inventory_item_id;
  if (!shopifyProduct?.id || !variant?.id || !inventoryItemId) {
    throw new Error("Shopify did not return the product details");
  }

  const locationId = Number(settings.shopify_location_id);
  if (!settings.shopify_location_id || !Number.isFinite(locationId)) {
    throw new Error("Enter your Shopify location ID in Settings first");
  }

  await shopifyRequest(settings, token, "POST", "/inventory_levels/connect.json", {
    location_id: locationId,
    inventory_item_id: inventoryItemId,
  });

  const stock = await shopifyRequest(settings, token, "POST", "/inventory_levels/set.json", {
    location_id: locationId,
    inventory_item_id: inventoryItemId,
    available: product.total_availability ?? 0,
  });
  if (!stock.ok) throw new Error(shopifyErrorMessage(stock.status, stock.data));

  const { error } = await supabase
    .from("products")
    .update({
      shopify_product_id: shopifyProduct.id,
      shopify_variant_id: variant.id,
      shopify_inventory_item_id: inventoryItemId,
      shopify_synced_at: new Date().toISOString(),
      shopify_error: null,
    })
    .eq("id", product.id);
  if (error) throw new Error(`Could not save Shopify IDs: ${error.message}`);
}

async function pushSelectedProducts(productIds: string[]) {
  const settings = await loadSettings();
  const token = getShopifyToken();

  const { data, error } = await supabase
    .from("products")
    .select(
      "id, ingram_part_number, vendor_name, vendor_part_number, upc, description, category, customer_cost, msrp, total_availability, shopify_product_id, shopify_variant_id, shopify_inventory_item_id",
    )
    .in("id", productIds)
    .eq("is_selected", true);
  if (error) throw new Error(`Could not load products: ${error.message}`);

  const products = (data ?? []) as Product[];
  let pushed = 0;
  const failures: { ingram_part_number: string; message: string }[] = [];

  for (const product of products) {
    try {
      await pushProduct(product, settings, token);
      pushed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      failures.push({ ingram_part_number: product.ingram_part_number, message });
      await supabase
        .from("products")
        .update({ shopify_error: message })
        .eq("id", product.id);
    }
    await sleep(DELAY_BETWEEN_PRODUCTS_MS);
  }

  return { pushed, failed: failures.length, failures };
}

async function testConnection() {
  const settings = await loadSettings();
  const token = getShopifyToken();
  const res = await shopifyRequest(settings, token, "GET", "/shop.json");
  if (!res.ok) throw new Error(shopifyErrorMessage(res.status, res.data));
  return { ok: true, message: `Connected to ${res.data?.shop?.name ?? settings.shopify_shop_domain}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const action = body?.action;

    if (action === "test") {
      return jsonResponse(await testConnection());
    }

    if (action === "push_products") {
      const ids = Array.isArray(body.product_ids) ? body.product_ids : [];
      if (ids.length === 0 || ids.length > MAX_PRODUCTS_PER_REQUEST) {
        return jsonResponse({ error: `Send between 1 and ${MAX_PRODUCTS_PER_REQUEST} product IDs` }, 400);
      }
      if (!ids.every((id: unknown) => typeof id === "string")) {
        return jsonResponse({ error: "Product IDs must be text values" }, 400);
      }
      return jsonResponse(await pushSelectedProducts(ids));
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return jsonResponse({ error: message }, 500);
  }
});
