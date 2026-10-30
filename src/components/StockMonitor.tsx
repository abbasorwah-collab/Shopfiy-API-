import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import StatusPill from '@/components/StatusPill';
import type { Tone } from '@/components/StatusPill';
import { formatCount, formatDateTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { runStockSync } from '@/lib/syncRunner';

const AUTO_CHECK_MS = 2 * 60 * 1000;
const LOW_STOCK_LIMIT = 5;
const ROW_LIMIT = 15;

type Row = {
  id: string;
  description: string | null;
  ingram_part_number: string;
  vendor_name: string;
  total_availability: number | null;
  shopify_stock_pushed: number | null;
  stock_error: string | null;
};

type Counts = { live: number; out: number; low: number; attention: number };

type MonitorData = {
  rows: Row[];
  counts: Counts;
  lastRunAt: string | null;
  lastResult: string | null;
};

function liveProducts() {
  return supabase.from('products').select('id', { count: 'exact', head: true }).not('shopify_inventory_item_id', 'is', null);
}

async function loadMonitor(): Promise<MonitorData> {
  const [rowsRes, liveRes, outRes, lowRes, attentionRes, settingsRes] = await Promise.all([
    supabase
      .from('products')
      .select('id, description, ingram_part_number, vendor_name, total_availability, shopify_stock_pushed, stock_error')
      .not('shopify_inventory_item_id', 'is', null)
      .order('total_availability', { ascending: true, nullsFirst: false })
      .limit(ROW_LIMIT),
    liveProducts(),
    liveProducts().eq('total_availability', 0),
    liveProducts().gt('total_availability', 0).lte('total_availability', LOW_STOCK_LIMIT),
    liveProducts().not('stock_error', 'is', null),
    supabase.from('sync_settings').select('stock_sync_last_run_at, stock_sync_last_result').eq('id', 1).maybeSingle(),
  ]);

  if (rowsRes.error || liveRes.error || outRes.error || lowRes.error || attentionRes.error || settingsRes.error) {
    throw new Error('Could not load the stock monitor.');
  }

  return {
    rows: (rowsRes.data ?? []) as Row[],
    counts: {
      live: liveRes.count ?? 0,
      out: outRes.count ?? 0,
      low: lowRes.count ?? 0,
      attention: attentionRes.count ?? 0,
    },
    lastRunAt: (settingsRes.data?.stock_sync_last_run_at as string | null) ?? null,
    lastResult: (settingsRes.data?.stock_sync_last_result as string | null) ?? null,
  };
}

function statusFor(row: Row): { label: string; tone: Tone } {
  if (row.stock_error) return { label: 'Check failed', tone: 'danger' };
  if (row.total_availability === 0) return { label: 'Out of stock', tone: 'danger' };
  if (row.shopify_stock_pushed !== row.total_availability) return { label: 'Updating', tone: 'warning' };
  if (row.total_availability !== null && row.total_availability <= LOW_STOCK_LIMIT) {
    return { label: 'Low stock', tone: 'warning' };
  }
  return { label: 'In stock', tone: 'success' };
}

export default function StockMonitor() {
  const [data, setData] = useState<MonitorData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const busy = useRef(false);

  const reload = useCallback(async () => {
    try {
      setData(await loadMonitor());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the stock monitor.');
    }
  }, []);

  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setChecking(true);
    setProgress('Starting');
    try {
      await runStockSync(setProgress);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The stock check did not finish. Try again.');
    } finally {
      busy.current = false;
      setChecking(false);
      setProgress(null);
      await reload();
    }
  }, [reload]);

  // Show what is stored right away, then check against Ingram Micro and keep checking while this page is open.
  useEffect(() => {
    void reload();
    void check();
    const timer = setInterval(() => void check(), AUTO_CHECK_MS);
    return () => clearInterval(timer);
  }, [reload, check]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Activity className="h-4 w-4 text-blue-600" /> Live stock monitor
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Compares Ingram Micro stock with your Shopify store and fixes Shopify when they differ. Rechecks every 2
            minutes while this page is open.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void check()}
          disabled={checking}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-white px-3.5 py-2 text-sm font-medium text-slate-700 ring-1 ring-inset ring-slate-300 transition-colors duration-150 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Check now
        </button>
      </div>

      {checking && progress && <p className="mt-3 text-sm text-blue-700">{progress}</p>}

      {error && (
        <div className="mt-4 flex gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {!data ? (
        !error && (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading stock
          </div>
        )
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Live in Shopify" value={data.counts.live} tone="text-slate-900" />
            <Stat label="Out of stock" value={data.counts.out} tone={data.counts.out > 0 ? 'text-red-600' : 'text-slate-900'} />
            <Stat label={`Low (${LOW_STOCK_LIMIT} or fewer)`} value={data.counts.low} tone={data.counts.low > 0 ? 'text-amber-600' : 'text-slate-900'} />
            <Stat label="Check failed" value={data.counts.attention} tone={data.counts.attention > 0 ? 'text-red-600' : 'text-slate-900'} />
          </div>

          <p className="mt-4 text-xs text-slate-500">
            Last check: {formatDateTime(data.lastRunAt)}
            {data.lastResult ? ` · ${data.lastResult}` : ''}
          </p>

          {data.rows.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">
              No products are live in Shopify yet. Push products from the Products page and they will be monitored here.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th scope="col" className="px-4 py-2.5">Lowest stock first</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Ingram</th>
                    <th scope="col" className="px-4 py-2.5 text-right">Shopify</th>
                    <th scope="col" className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.rows.map((row) => {
                    const status = statusFor(row);
                    return (
                      <tr key={row.id}>
                        <td className="max-w-md px-4 py-2.5">
                          <p className="truncate font-medium text-slate-900">{row.description ?? row.ingram_part_number}</p>
                          <p className="text-xs text-slate-500">
                            {row.vendor_name} · {row.ingram_part_number}
                          </p>
                          {row.stock_error && <p className="mt-0.5 text-xs text-red-600">{row.stock_error}</p>}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                          {row.total_availability === null ? '—' : formatCount(row.total_availability)}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                          {row.shopify_stock_pushed === null ? '—' : formatCount(row.shopify_stock_pushed)}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusPill tone={status.tone}>{status.label}</StatusPill>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-4 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums tracking-tight ${tone}`}>{formatCount(value)}</p>
    </div>
  );
}
