import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, ArrowRight, Loader2 } from 'lucide-react';
import type { ViewId } from '@/components/AppShell';
import StatusPill from '@/components/StatusPill';
import StockMonitor from '@/components/StockMonitor';
import { formatCount, formatDateTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { SyncSettings, Vendor } from '@/lib/types';

type Stats = {
  enabledVendors: number;
  products: number;
  selected: number;
  live: number;
};

type DashboardData = {
  stats: Stats;
  vendors: Vendor[];
  settings: SyncSettings | null;
};

async function loadDashboard(): Promise<DashboardData> {
  const [vendorsRes, settingsRes, productsRes, selectedRes, liveRes, enabledRes] = await Promise.all([
    supabase
      .from('vendors')
      .select('id, name, enabled, last_catalog_synced_at, last_pricing_synced_at, last_error')
      .order('name'),
    supabase
      .from('sync_settings')
      .select('ingram_customer_number, ingram_country_code, ingram_sender_id, markup_percent, shopify_shop_domain, shopify_location_id')
      .eq('id', 1)
      .maybeSingle(),
    supabase.from('products').select('id', { count: 'exact', head: true }),
    supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_selected', true),
    supabase.from('products').select('id', { count: 'exact', head: true }).not('shopify_synced_at', 'is', null),
    supabase.from('vendors').select('id', { count: 'exact', head: true }).eq('enabled', true),
  ]);

  if (vendorsRes.error || settingsRes.error || productsRes.error || selectedRes.error || liveRes.error || enabledRes.error) {
    throw new Error('Could not load dashboard figures');
  }

  return {
    vendors: (vendorsRes.data ?? []) as Vendor[],
    settings: (settingsRes.data as SyncSettings | null) ?? null,
    stats: {
      enabledVendors: enabledRes.count ?? 0,
      products: productsRes.count ?? 0,
      selected: selectedRes.count ?? 0,
      live: liveRes.count ?? 0,
    },
  };
}

type DashboardViewProps = {
  onNavigate: (view: ViewId) => void;
};

export default function DashboardView({ onNavigate }: DashboardViewProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    loadDashboard()
      .then((result) => {
        if (active) setData(result);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return <ErrorState message={error} />;
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading your dashboard
      </div>
    );
  }

  const checklist = [
    { label: 'Ingram Micro customer number', done: Boolean(data.settings?.ingram_customer_number) },
    { label: 'Shopify store domain', done: Boolean(data.settings?.shopify_shop_domain) },
    { label: 'Shopify location ID', done: Boolean(data.settings?.shopify_location_id) },
    { label: 'At least one vendor added', done: data.vendors.length > 0 },
  ];
  const setupComplete = checklist.every((item) => item.done);
  const vendorIssues = data.vendors.filter((vendor) => vendor.last_error);

  const statCards = [
    { label: 'Active vendors', value: data.stats.enabledVendors },
    { label: 'Products imported', value: data.stats.products },
    { label: 'Selected for Shopify', value: data.stats.selected },
    { label: 'Live on Shopify', value: data.stats.live },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">An overview of your Ingram Micro catalog and Shopify sync.</p>
      </div>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {statCards.map((card) => (
          <div key={card.label} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{formatCount(card.value)}</p>
          </div>
        ))}
      </section>

      {setupComplete && <StockMonitor />}

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Setup checklist</h2>
            {setupComplete ? (
              <StatusPill tone="success">Ready to sync</StatusPill>
            ) : (
              <StatusPill tone="warning">Setup incomplete</StatusPill>
            )}
          </div>
          <ul className="mt-4 divide-y divide-slate-100">
            {checklist.map((item) => (
              <li key={item.label} className="flex items-center gap-3 py-3">
                {item.done ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                ) : (
                  <span className="h-5 w-5 rounded-full border-2 border-slate-300" />
                )}
                <span className={`text-sm ${item.done ? 'text-slate-700' : 'text-slate-500'}`}>{item.label}</span>
              </li>
            ))}
          </ul>
          {!setupComplete && (
            <button
              type="button"
              onClick={() => onNavigate('settings')}
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 transition-colors hover:text-blue-800"
            >
              Open settings <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <h2 className="text-base font-semibold text-slate-900">Vendor status</h2>
          {data.vendors.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No vendors yet. Add one to start importing products.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {data.vendors.map((vendor) => (
                <li key={vendor.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{vendor.name}</p>
                    <p className="text-xs text-slate-500">
                      Catalog: {formatDateTime(vendor.last_catalog_synced_at)}
                    </p>
                  </div>
                  {vendor.last_error ? (
                    <StatusPill tone="danger">Error</StatusPill>
                  ) : vendor.enabled ? (
                    <StatusPill tone="success">Active</StatusPill>
                  ) : (
                    <StatusPill tone="neutral">Paused</StatusPill>
                  )}
                </li>
              ))}
            </ul>
          )}
          {vendorIssues.length > 0 && (
            <div className="mt-5 flex gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {vendorIssues.length === 1 ? '1 vendor needs attention.' : `${vendorIssues.length} vendors need attention.`}{' '}
                Open Vendors to see the details.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
      <p className="font-medium">Something went wrong</p>
      <p className="mt-1">{message}</p>
    </div>
  );
}
