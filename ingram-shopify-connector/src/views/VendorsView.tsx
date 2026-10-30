import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import AddVendorForm from '@/components/AddVendorForm';
import VendorCard, { type VendorBusyState } from '@/components/VendorCard';
import { supabase } from '@/lib/supabase';
import { importVendorCatalog, refreshVendorPricing } from '@/lib/syncRunner';
import type { Vendor } from '@/lib/types';

type Notice = { tone: 'success' | 'error'; text: string };

type VendorListData = {
  vendors: Vendor[];
  counts: Record<string, number>;
};

async function loadVendorList(): Promise<VendorListData> {
  const { data, error } = await supabase
    .from('vendors')
    .select('id, name, enabled, last_catalog_synced_at, last_pricing_synced_at, last_error')
    .order('name');
  if (error) throw new Error('Could not load vendors. Refresh the page to try again.');

  const vendors = (data ?? []) as Vendor[];
  const countResults = await Promise.all(
    vendors.map((vendor) =>
      supabase
        .from('products')
        .select('id', { count: 'exact', head: true })
        .eq('vendor_name', vendor.name),
    ),
  );

  const counts: Record<string, number> = {};
  vendors.forEach((vendor, index) => {
    counts[vendor.name] = countResults[index].count ?? 0;
  });
  return { vendors, counts };
}

export default function VendorsView() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<VendorBusyState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const reload = useCallback(async () => {
    try {
      const result = await loadVendorList();
      setVendors(result.vendors);
      setCounts(result.counts);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load vendors.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function runSync(vendor: Vendor, kind: 'catalog' | 'pricing') {
    setNotice(null);
    setBusy({
      vendorName: vendor.name,
      kind,
      message: kind === 'catalog' ? 'Starting catalog import' : 'Starting price and stock refresh',
    });
    try {
      const onProgress = (message: string) =>
        setBusy({ vendorName: vendor.name, kind, message });
      if (kind === 'catalog') {
        await importVendorCatalog(vendor.name, onProgress);
        setNotice({ tone: 'success', text: `${vendor.name} catalog imported.` });
      } else {
        await refreshVendorPricing(vendor.name, onProgress);
        setNotice({ tone: 'success', text: `${vendor.name} prices and stock updated.` });
      }
    } catch (err) {
      setNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'The sync did not finish. Try again.',
      });
    } finally {
      setBusy(null);
      await reload();
    }
  }

  async function toggleEnabled(vendor: Vendor) {
    const nextValue = !vendor.enabled;
    setVendors((current) =>
      current.map((item) => (item.id === vendor.id ? { ...item, enabled: nextValue } : item)),
    );
    const { error } = await supabase.from('vendors').update({ enabled: nextValue }).eq('id', vendor.id);
    if (error) {
      setNotice({ tone: 'error', text: `Could not update ${vendor.name}. Try again.` });
    }
    await reload();
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-16 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading vendors
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Vendors</h1>
        <p className="mt-1 text-sm text-slate-500">
          Import each manufacturer's catalog from Ingram Micro, then refresh prices and stock.
        </p>
      </div>

      {notice && (
        <div
          role="status"
          className={`rounded-lg px-4 py-3 text-sm ring-1 ring-inset ${
            notice.tone === 'success'
              ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
              : 'bg-red-50 text-red-700 ring-red-200'
          }`}
        >
          {notice.text}
        </div>
      )}

      {loadError && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-inset ring-red-200">
          {loadError}
        </div>
      )}

      <AddVendorForm
        existingNames={vendors.map((vendor) => vendor.name)}
        onAdded={() => void reload()}
        onError={(text) => setNotice({ tone: 'error', text })}
      />

      {vendors.length === 0 ? (
        <p className="text-sm text-slate-500">No vendors yet. Add a manufacturer above to get started.</p>
      ) : (
        <div className="grid gap-5 md:grid-cols-2">
          {vendors.map((vendor) => (
            <VendorCard
              key={vendor.id}
              vendor={vendor}
              productCount={counts[vendor.name] ?? 0}
              busy={busy}
              anyBusy={busy !== null}
              onImport={() => void runSync(vendor, 'catalog')}
              onRefresh={() => void runSync(vendor, 'pricing')}
              onToggleEnabled={() => void toggleEnabled(vendor)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
