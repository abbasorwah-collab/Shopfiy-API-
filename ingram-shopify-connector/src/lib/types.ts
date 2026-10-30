export type Vendor = {
  id: string;
  name: string;
  enabled: boolean;
  last_catalog_synced_at: string | null;
  last_pricing_synced_at: string | null;
  last_error: string | null;
};

export type Product = {
  id: string;
  ingram_part_number: string;
  vendor_name: string;
  vendor_part_number: string | null;
  upc: string | null;
  description: string | null;
  category: string | null;
  sub_category: string | null;
  is_selected: boolean;
  customer_cost: number | null;
  msrp: number | null;
  currency: string | null;
  total_availability: number | null;
  pricing_updated_at: string | null;
  shopify_product_id: number | null;
  shopify_inventory_item_id: number | null;
  shopify_synced_at: string | null;
  shopify_error: string | null;
  shopify_stock_pushed: number | null;
  stock_checked_at: string | null;
  stock_error: string | null;
};

export type SyncSettings = {
  ingram_customer_number: string;
  ingram_country_code: string;
  ingram_sender_id: string;
  markup_percent: number;
  shopify_shop_domain: string;
  shopify_location_id: string;
};

export type CatalogPageResult = {
  processed: number;
  recordsFound: number;
  hasMore: boolean;
  nextPage: number;
};

export type PricingBatchResult = {
  processed: number;
  remaining: number;
};

export type PushResult = {
  pushed: number;
  failed: number;
  failures: { ingram_part_number: string; message: string }[];
};

export type StockSyncResult = {
  checked: number;
  changed: number;
  failed: number;
  deferred: number;
  zeroed: string[];
  tracked: number;
  remaining: number;
  summary: string;
};

export type StockSyncSummary = {
  checked: number;
  changed: number;
  failed: number;
  zeroed: string[];
  tracked: number;
};

export type ConnectionTestResult = {
  ok: boolean;
  message: string;
};
