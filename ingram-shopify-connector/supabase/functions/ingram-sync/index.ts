import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const INGRAM_TOKEN_URL = "https://api.ingrammicro.com:443/oauth/oauth30/token";
const INGRAM_API_URL = "https://api.ingrammicro.com:443/resellers/v6";
const CATALOG_PAGE_SIZE = 100;
const PRICING_BATCH_SIZE = 100;
const PRICING_CHUNK_SIZE = 50;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type Settings = {
  ingram_customer_number: string;
  ingram_country_code: string;
  ingram_sender_id: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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
    .select("ingram_customer_number, ingram_country_code, ingram_sender_id")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw new Error(`Could not load settings: ${error.message}`);
  if (!data) throw new Error("Sync settings are missing");
  if (!data.ingram_customer_number) {
    throw new Error("Enter your Ingram Micro customer number in Settings first");
  }
  return data as Settings;
}

async function getIngramToken(): Promise<string> {
  const clientId = Deno.env.get("INGRAM_CLIENT_ID");
  const clientSecret = Deno.env.get("INGRAM_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Ingram Micro API credentials are not configured");
  }

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
  if (!res.ok || !data?.access_token) {
    throw new Error(`Ingram Micro authentication failed (${res.status})`);
  }
  return data.access_token as string;
}

async function ingramRequest(
  token: string,
  settings: Settings,
  path: string,
  options: { method?: "GET" | "POST"; query?: Record<string, string>; body?: unknown } = {},
): Promise<any> {
  const url = new URL(INGRAM_API_URL + path);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const res = await fetch(url, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "IM-CustomerNumber": settings.ingram_customer_number,
      "IM-CountryCode": settings.ingram_country_code,
      "IM-SenderID": settings.ingram_sender_id,
      "IM-CorrelationID": crypto.randomUUID().replace(/-/g, ""),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 404 || res.status === 204) return null;

  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    if (res.ok) throw new Error("Ingram Micro returned an unexpected response");
  }

  if (!res.ok) {
    const detail = data?.errors?.[0]?.message ?? data?.message ?? text.slice(0, 300) ?? "no details";
    throw new Error(`Ingram Micro request failed (${res.status}): ${detail || "no details"}`);
  }
  return data;
}

async function importCatalogPage(vendorName: string, page: number) {
  const settings = await loadSettings();
  const token = await getIngramToken();

  const data = await ingramRequest(token, settings, "/catalog", {
    query: {
      vendor: vendorName,
      pageNumber: String(page),
      pageSize: String(CATALOG_PAGE_SIZE),
    },
  });

  const items: any[] = Array.isArray(data?.catalog) ? data.catalog : [];
  const syncedAt = new Date().toISOString();

  const rowsByPartNumber = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    const partNumber = typeof item?.ingramPartNumber === "string" ? item.ingramPartNumber.trim() : "";
    if (!partNumber) continue;
    rowsByPartNumber.set(partNumber, {
      ingram_part_number: partNumber,
      vendor_name: vendorName,
      vendor_part_number: item.vendorPartNumber || null,
      upc: item.upcCode || null,
      description: item.description || item.extraDescription || null,
      category: item.category || null,
      sub_category: item.subCategory || null,
      catalog_synced_at: syncedAt,
    });
  }
  const rows = [...rowsByPartNumber.values()];

  if (rows.length > 0) {
    const { error } = await supabase
      .from("products")
      .upsert(rows, { onConflict: "ingram_part_number" });
    if (error) throw new Error(`Could not save products: ${error.message}`);
  }

  const recordsFound = toNumber(data?.recordsFound) ?? 0;
  const hasMore = items.length > 0 && page * CATALOG_PAGE_SIZE < recordsFound;

  if (!hasMore) {
    const { error } = await supabase
      .from("vendors")
      .update({ last_catalog_synced_at: syncedAt, last_error: null })
      .eq("name", vendorName);
    if (error) throw new Error(`Could not update vendor: ${error.message}`);
  }

  return { processed: rows.length, recordsFound, hasMore, nextPage: page + 1 };
}

async function refreshPricingBatch(vendorName: string, restart: boolean) {
  const settings = await loadSettings();

  if (restart) {
    const { error } = await supabase
      .from("products")
      .update({ pricing_updated_at: null })
      .eq("vendor_name", vendorName);
    if (error) throw new Error(`Could not reset pricing: ${error.message}`);
  }

  const { data: due, error: dueError } = await supabase
    .from("products")
    .select("ingram_part_number")
    .eq("vendor_name", vendorName)
    .is("pricing_updated_at", null)
    .order("ingram_part_number")
    .limit(PRICING_BATCH_SIZE);
  if (dueError) throw new Error(`Could not load products: ${dueError.message}`);

  const partNumbers = (due ?? []).map((row) => row.ingram_part_number as string);
  const token = partNumbers.length > 0 ? await getIngramToken() : "";
  const pricedAt = new Date().toISOString();

  for (let i = 0; i < partNumbers.length; i += PRICING_CHUNK_SIZE) {
    const chunk = partNumbers.slice(i, i + PRICING_CHUNK_SIZE);
    const data = await ingramRequest(token, settings, "/catalog/priceandavailability", {
      method: "POST",
      query: { includeAvailability: "true", includePricing: "true" },
      body: { products: chunk.map((ingramPartNumber) => ({ ingramPartNumber })) },
    });

    const results: any[] = Array.isArray(data) ? data : [];
    const resultByPartNumber = new Map<string, any>();
    for (const result of results) {
      if (typeof result?.ingramPartNumber === "string") {
        resultByPartNumber.set(result.ingramPartNumber, result);
      }
    }

    const rows = chunk.map((partNumber) => {
      const result = resultByPartNumber.get(partNumber);
      const pricing = result?.pricing ?? null;
      const availability = result?.availability ?? null;
      return {
        ingram_part_number: partNumber,
        vendor_name: vendorName,
        customer_cost: toNumber(pricing?.customerPrice),
        msrp: toNumber(pricing?.retailPrice),
        map_price: toNumber(pricing?.mapPrice),
        currency: pricing?.currencyCode ?? null,
        total_availability: Math.max(0, Math.round(toNumber(availability?.totalAvailability) ?? 0)),
        availability_by_warehouse: Array.isArray(availability?.availabilityByWarehouse)
          ? availability.availabilityByWarehouse
          : [],
        pricing_updated_at: pricedAt,
      };
    });

    const { error } = await supabase
      .from("products")
      .upsert(rows, { onConflict: "ingram_part_number" });
    if (error) throw new Error(`Could not save pricing: ${error.message}`);
  }

  const { count, error: countError } = await supabase
    .from("products")
    .select("ingram_part_number", { count: "exact", head: true })
    .eq("vendor_name", vendorName)
    .is("pricing_updated_at", null);
  if (countError) throw new Error(`Could not count remaining products: ${countError.message}`);

  const remaining = count ?? 0;
  if (remaining === 0) {
    const { error } = await supabase
      .from("vendors")
      .update({ last_pricing_synced_at: pricedAt, last_error: null })
      .eq("name", vendorName);
    if (error) throw new Error(`Could not update vendor: ${error.message}`);
  }

  return { processed: partNumbers.length, remaining };
}

async function testConnection() {
  const settings = await loadSettings();
  await getIngramToken();
  return { ok: true, message: `Connected to Ingram Micro for customer ${settings.ingram_customer_number}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  let vendorName: string | null = null;
  try {
    const body = await req.json();
    const action = body?.action;
    if (typeof body?.vendor_name === "string" && body.vendor_name.trim()) {
      vendorName = body.vendor_name.trim();
    }

    if (action === "test") {
      return jsonResponse(await testConnection());
    }

    if (!vendorName) {
      return jsonResponse({ error: "A vendor name is required" }, 400);
    }

    if (action === "catalog_page") {
      const page = Number(body.page);
      if (!Number.isInteger(page) || page < 1) {
        return jsonResponse({ error: "Page must be a positive whole number" }, 400);
      }
      return jsonResponse(await importCatalogPage(vendorName, page));
    }

    if (action === "pricing_batch") {
      return jsonResponse(await refreshPricingBatch(vendorName, body.restart === true));
    }

    return jsonResponse({ error: "Unknown action" }, 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    if (vendorName) {
      await supabase.from("vendors").update({ last_error: message }).eq("name", vendorName);
    }
    return jsonResponse({ error: message }, 500);
  }
});
