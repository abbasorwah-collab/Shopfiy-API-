import { callFunction } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type {
  CatalogPageResult,
  PricingBatchResult,
  PushResult,
  StockSyncResult,
  StockSyncSummary,
} from '@/lib/types';

const MAX_STOCK_PASSES = 10;

// Verifies Ingram Micro stock for every product live in Shopify and corrects Shopify where it differs.
// Each pass checks up to 150 products; passes repeat until all have been checked once.
export async function runStockSync(onProgress?: (message: string) => void): Promise<StockSyncSummary> {
  const since = new Date().toISOString();
  const total: StockSyncSummary = { checked: 0, changed: 0, failed: 0, zeroed: [], tracked: 0 };

  for (let pass = 1; pass <= MAX_STOCK_PASSES; pass++) {
    const result = await callFunction<StockSyncResult>('stock-sync', { action: 'run', since });
    total.checked += result.checked;
    total.changed += result.changed;
    total.failed += result.failed;
    total.zeroed.push(...result.zeroed);
    total.tracked = result.tracked;
    onProgress?.(`Checked ${total.checked + total.failed} of ${result.tracked} live products`);

    if (result.remaining === 0) break;
    if (result.checked + result.failed === 0) break; // nothing moved forward; stop rather than loop
  }

  return total;
}

const SHOPIFY_BATCH_SIZE = 10;
const PAGE_SIZE = 1000;

export async function importVendorCatalog(
  vendorName: string,
  onProgress: (message: string) => void,
): Promise<void> {
  let page = 1;
  let imported = 0;
  for (;;) {
    const result = await callFunction<CatalogPageResult>('ingram-sync', {
      action: 'catalog_page',
      vendor_name: vendorName,
      page,
    });
    imported += result.processed;
    onProgress(`Imported ${imported.toLocaleString('en-US')} of ${result.recordsFound.toLocaleString('en-US')} products`);
    if (!result.hasMore) return;
    page = result.nextPage;
  }
}

export async function refreshVendorPricing(
  vendorName: string,
  onProgress: (message: string) => void,
): Promise<void> {
  let restart = true;
  let refreshed = 0;
  for (;;) {
    const result = await callFunction<PricingBatchResult>('ingram-sync', {
      action: 'pricing_batch',
      vendor_name: vendorName,
      restart,
    });
    restart = false;
    refreshed += result.processed;
    if (result.remaining === 0) {
      onProgress(`Refreshed prices and stock for ${refreshed.toLocaleString('en-US')} products`);
      return;
    }
    if (result.processed === 0) {
      throw new Error('Pricing refresh stopped before all products were updated. Try again.');
    }
    onProgress(`Refreshed ${refreshed.toLocaleString('en-US')} products, ${result.remaining.toLocaleString('en-US')} left`);
  }
}

export async function pushSelectedToShopify(
  onProgress: (message: string) => void,
): Promise<PushResult> {
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('products')
      .select('id')
      .eq('is_selected', true)
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error('Could not load your selected products. Try again.');
    ids.push(...(data ?? []).map((row) => row.id as string));
    if (!data || data.length < PAGE_SIZE) break;
  }

  const total: PushResult = { pushed: 0, failed: 0, failures: [] };

  for (let i = 0; i < ids.length; i += SHOPIFY_BATCH_SIZE) {
    const batch = ids.slice(i, i + SHOPIFY_BATCH_SIZE);
    const result = await callFunction<PushResult>('shopify-sync', {
      action: 'push_products',
      product_ids: batch,
    });
    total.pushed += result.pushed;
    total.failed += result.failed;
    total.failures.push(...result.failures);
    onProgress(`Pushed ${Math.min(i + batch.length, ids.length)} of ${ids.length} products`);
  }

  return total;
}
