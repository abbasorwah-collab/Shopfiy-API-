import { createClient } from "npm:@supabase/supabase-js@2";

/*
  Keeps Shopify stock in step with Ingram Micro.

  Every run it looks at products that are already live in Shopify (selected or not, because
  deselected products stay in the store), asks Ingram Micro for their current stock, and sets
  the Shopify quantity whenever it differs from what Shopify was last given.

  Safety rules:
  - If Ingram does not answer for a product, nothing is changed for it; it is flagged instead.
    A missing answer is never treated as "zero stock".
  - A Shopify error leaves the product flagged and it is retried on the next run.
  - Runs are idempotent, so overlapping runs (scheduler plus the dashboard) are harmless.
*/

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const INGRAM_TOKEN_URL = "https://api.ingrammicro.com:443/oauth/oauth30/token";
const INGRAM_API_URL = "https://api.ingrammicro.com:443/resellers/v6";
const SHOPIFY_API_VERSION = "2025-01";

const CHECK_BATCH_SIZE = 150; // products verified per run
const RETRY_FIRST_SIZE = 50; // flagged products re-tried at the start of every run
const INGRAM_CHUNK_SIZE = 50;
const DELAY_BETWEEN_SHOPIFY_CALLS_MS = 550; // Shopify REST allows about 2 calls per second
const TIME_BUDGET_MS = 110_000; // stop calling Shopify before the function time limit

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type Settings = {
  ingram_customer_number: string;
  ingram_country_code: string;
  ingram_sender_id: string;
  shopify_shop_domain: string;
  shopify_location_id: string;
};

type TrackedProduct = {
  id: string;
  ingram_part_number: string;
  customer_cost: number | null;
  shopify_inventory_item_id: number;
  shopify_stock_pushed: number | null;
  total_availability: number | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

async function loadSettings(): Promise<Settings> {
  const { data, error } = await supabase
    .from("sync_settings")
    .select(
      "ingram_customer_number, ingram_country_code, ingram_sender_id, shopify_shop_domain, shopify_location_id",
    )
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`Could not load settings: ${error.message}`);
  if (!data) throw new Error("Sync settings are missing");
  if (!data.ingram_customer_number) throw new Error("Enter your Ingram Micro customer number in Settings first");
  if (!data.shopify_shop_domain) throw new Error("Enter your Shopify store domain in Settings first");
  if (!data.shopify_location_id || !Number.isFinite(Number(data.shopify_location_id))) {
    throw new Error("Enter your Shopify location ID in Settings first");
  }
  return data as Settings;
}

async function getIngramToken(): Promise<string> {
  const clientId = Deno.env.get("INGRAM_CLIENT_ID");
  const clientSecret = Deno.env.get("INGRAM_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new Error("Ingram Micro API credentials are not configured");

  const res = await fetch(INGRAM_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.access_token) throw new Error(`Ingram Micro authentication failed (${res.status})`);
  return data.access_token as string;
}

async function ingramPriceAndAvailability(token: string, settings: Settings, partNumbers: string[]) {
  const url = new URL(`${INGRAM_API_URL}/catalog/priceandavailability`);
  url.searchParams.set("includeAvailability", "true");
  url.searchParams.set("includePricing", "true");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "IM-CustomerNumber": settings.ingram_customer_number,
      "IM-CountryCode": settings.ingram_country_code,
      "IM-SenderID": settings.ingram_sender_id,
      "IM-CorrelationID": crypto.randomUUID().replace(/-/g, ""),
    },
    body: JSON.stringify({ products: partNumbers.map((ingramPartNumber) => ({ ingramPartNumber })) }),
  });

  if (res.status === 404 || res.status === 204) return [];
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // handled below
  }
  if (!res.ok) {
    const detail = data?.errors?.[0]?.message ?? data?.message ?? text.slice(0, 200);
    throw new Error(`Ingram Micro request failed (${res.status}): ${detail || "no details"}`);
  }
  return Array.isArray(data) ? data : [];
}

async function setShopifyStock(
  settings: Settings,
  token: string,
  inventoryItemId: number,
  available: number,
): Promise<{ ok: boolean; message: string }> {
  const url = `https://${settings.shopify_shop_domain}/admin/api/${SHOPIFY_API_VERSION}/inventory_levels/set.json`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        location_id: Number(settings.shopify_location_id),
        inventory_item_id: inventoryItemId,
        available,
      }),
    });

    if (res.status === 429 && attempt === 0) {
      const wait = Number(res.headers.get("Retry-After")) || 2;
      await sleep(Math.min(wait, 5) * 1000);
      continue;
    }

    if (res.ok) return { ok: true, message: "" };
    const text = await res.text();
    let detail = text.slice(0, 200);
    try {
      const parsed = JSON.parse(text);
      if (parsed?.errors) detail = typeof parsed.errors === "string" ? parsed.errors : JSON.stringify(parsed.errors);
    } catch {
      // keep raw text
    }
    return { ok: false, message: `Shopify rejected the stock update (${res.status}): ${detail || "no details"}` };
  }
  return { ok: false, message: "Shopify is rate limiting requests. This will be retried on the next check." };
}

async function selectProductsToCheck(): Promise<{ products: TrackedProduct[]; tracked: number }> {
  const columns =
    "id, ingram_part_number, customer_cost, shopify_inventory_item_id, shopify_stock_pushed, total_availability";

  // Products that failed last time go first, so a problem never waits behind the rotation.
  const { data: flagged, error: flaggedError } = await supabase
    .from("products")
    .select(columns)
    .not("shopify_inventory_item_id", "is", null)
    .not("stock_error", "is", null)
    .order("stock_checked_at", { ascending: true, nullsFirst: true })
    .limit(RETRY_FIRST_SIZE);
  if (flaggedError) throw new Error(`Could not load products: ${flaggedError.message}`);

  const flaggedIds = (flagged ?? []).map((row) => row.id as string);

  let rest = supabase
    .from("products")
    .select(columns, { count: "exact" })
    .not("shopify_inventory_item_id", "is", null)
    .order("stock_checked_at", { ascending: true, nullsFirst: true })
    .limit(CHECK_BATCH_SIZE - flaggedIds.length);
  if (flaggedIds.length > 0) rest = rest.not("id", "in", `(${flaggedIds.join(",")})`);

  const { data: oldest, count, error: oldestError } = await rest;
  if (oldestError) throw new Error(`Could not load products: ${oldestError.message}`);

  return {
    products: [...(flagged ?? []), ...(oldest ?? [])] as TrackedProduct[],
    tracked: (count ?? 0) + flaggedIds.length,
  };
}

async function runStockSync(sinceInput: unknown) {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const since =
    typeof sinceInput === "string" && !Number.isNaN(Date.parse(sinceInput)) ? sinceInput : startedAt;

  const settings = await loadSettings();
  const shopifyToken = Deno.env.get("SHOPIFY_ACCESS_TOKEN");
  if (!shopifyToken) throw new Error("Shopify access token is not configured");

  const { products, tracked } = await selectProductsToCheck();

  let verified = 0;
  let changed = 0;
  let failed = 0;
  let deferred = 0;
  const zeroed: string[] = [];

  if (products.length > 0) {
    const ingramToken = await getIngramToken();

    for (let i = 0; i < products.length; i += INGRAM_CHUNK_SIZE) {
      const chunk = products.slice(i, i + INGRAM_CHUNK_SIZE);
      const now = new Date().toISOString();

      let results: any[];
      try {
        results = await ingramPriceAndAvailability(
          ingramToken,
          settings,
          chunk.map((product) => product.ingram_part_number),
        );
      } catch (err) {
        // Ingram is unreachable for this chunk: change nothing, flag it, keep Shopify as it is.
        const message = err instanceof Error ? err.message : "Ingram Micro check failed";
        for (const product of chunk) {
          await supabase
            .from("products")
            .update({ stock_error: message, stock_checked_at: now })
            .eq("id", product.id);
        }
        failed += chunk.length;
        continue;
      }

      const byPartNumber = new Map<string, any>();
      for (const result of results) {
        if (typeof result?.ingramPartNumber === "string") byPartNumber.set(result.ingramPartNumber, result);
      }

      for (const product of chunk) {
        const result = byPartNumber.get(product.ingram_part_number);
        const total = toNumber(result?.availability?.totalAvailability);

        if (total === null) {
          await supabase
            .from("products")
            .update({
              stock_error: "Ingram Micro did not return stock for this product. Shopify was left unchanged.",
              stock_checked_at: now,
            })
            .eq("id", product.id);
          failed += 1;
          continue;
        }

        const newStock = Math.max(0, Math.round(total));
        const update: Record<string, unknown> = {
          total_availability: newStock,
          availability_by_warehouse: Array.isArray(result?.availability?.availabilityByWarehouse)
            ? result.availability.availabilityByWarehouse
            : [],
        };

        // If Ingram's price moved, record it so the product shows "Needs update" for a re-push.
        const cost = toNumber(result?.pricing?.customerPrice);
        if (cost !== null && cost !== Number(product.customer_cost)) {
          update.customer_cost = cost;
          update.msrp = toNumber(result?.pricing?.retailPrice);
          update.map_price = toNumber(result?.pricing?.mapPrice);
          update.currency = result?.pricing?.currencyCode ?? null;
          update.pricing_updated_at = now;
        }

        if (product.shopify_stock_pushed === newStock) {
          await supabase
            .from("products")
            .update({ ...update, stock_checked_at: now, stock_error: null })
            .eq("id", product.id);
          verified += 1;
          continue;
        }

        if (Date.now() - startedMs > TIME_BUDGET_MS) {
          // Out of time: keep the fresh Ingram number, leave this product at the front of the queue.
          await supabase.from("products").update(update).eq("id", product.id);
          deferred += 1;
          continue;
        }

        const pushed = await setShopifyStock(settings, shopifyToken, product.shopify_inventory_item_id, newStock);
        await sleep(DELAY_BETWEEN_SHOPIFY_CALLS_MS);

        if (pushed.ok) {
          const wasAvailable = (product.shopify_stock_pushed ?? product.total_availability ?? 1) > 0;
          if (newStock === 0 && wasAvailable) zeroed.push(product.ingram_part_number);
          await supabase
            .from("products")
            .update({ ...update, shopify_stock_pushed: newStock, stock_checked_at: now, stock_error: null })
            .eq("id", product.id);
          verified += 1;
          changed += 1;
        } else {
          await supabase
            .from("products")
            .update({ ...update, stock_error: pushed.message, stock_checked_at: now })
            .eq("id", product.id);
          failed += 1;
        }
      }
    }
  }

  const { count: remainingCount } = await supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .not("shopify_inventory_item_id", "is", null)
    .or(`stock_checked_at.is.null,stock_checked_at.lt.${since}`);

  const summary =
    `Checked ${verified + failed + deferred} of ${tracked} live products. ` +
    `${changed} updated in Shopify, ${zeroed.length} newly out of stock` +
    (failed > 0 ? `, ${failed} could not be checked` : "") +
    ".";

  await supabase
    .from("sync_settings")
    .update({ stock_sync_last_run_at: new Date().toISOString(), stock_sync_last_result: summary })
    .eq("id", 1);

  return {
    checked: verified,
    changed,
    failed,
    deferred,
    zeroed: zeroed.slice(0, 25),
    tracked,
    remaining: remainingCount ?? 0,
    summary,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action ?? "run";
    if (action !== "run") return jsonResponse({ error: "Unknown action" }, 400);
    return jsonResponse(await runStockSync(body?.since));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    await supabase
      .from("sync_settings")
      .update({ stock_sync_last_run_at: new Date().toISOString(), stock_sync_last_result: `Failed: ${message}` })
      .eq("id", 1);
    return jsonResponse({ error: message }, 500);
  }
});
