import { AlertTriangle, Download, Loader2, RefreshCw } from 'lucide-react';
import { formatDateTime } from '@/lib/format';
import type { Vendor } from '@/lib/types';
import StatusPill from '@/components/StatusPill';

export type VendorBusyState = {
  vendorName: string;
  kind: 'catalog' | 'pricing';
  message: string;
};

type VendorCardProps = {
  vendor: Vendor;
  productCount: number;
  busy: VendorBusyState | null;
  anyBusy: boolean;
  onImport: () => void;
  onRefresh: () => void;
  onToggleEnabled: () => void;
};

export default function VendorCard({
  vendor,
  productCount,
  busy,
  anyBusy,
  onImport,
  onRefresh,
  onToggleEnabled,
}: VendorCardProps) {
  const isBusy = busy?.vendorName === vendor.name;
  const hasCatalog = vendor.last_catalog_synced_at !== null;

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow duration-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-slate-900">{vendor.name}</h3>
          <p className="mt-1 text-sm text-slate-500">{productCount.toLocaleString('en-US')} products</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {vendor.last_error ? (
            <StatusPill tone="danger">Needs attention</StatusPill>
          ) : vendor.enabled ? (
            <StatusPill tone="success">Active</StatusPill>
          ) : (
            <StatusPill tone="neutral">Paused</StatusPill>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={vendor.enabled}
            aria-label={`${vendor.enabled ? 'Pause' : 'Resume'} ${vendor.name}`}
            disabled={anyBusy}
            onClick={onToggleEnabled}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-50 ${
              vendor.enabled ? 'bg-blue-600' : 'bg-slate-300'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
                vendor.enabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-slate-500">Catalog imported</dt>
          <dd className="mt-0.5 font-medium text-slate-800">{formatDateTime(vendor.last_catalog_synced_at)}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Prices and stock updated</dt>
          <dd className="mt-0.5 font-medium text-slate-800">{formatDateTime(vendor.last_pricing_synced_at)}</dd>
        </div>
      </dl>

      {vendor.last_error && (
        <div className="mt-4 flex gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="break-words">{vendor.last_error}</p>
        </div>
      )}

      {isBusy && busy && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-700">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <p>{busy.message}</p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onImport}
          disabled={anyBusy || !vendor.enabled}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Download className="h-4 w-4" />
          {hasCatalog ? 'Re-import catalog' : 'Import catalog'}
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={anyBusy || !vendor.enabled || !hasCatalog}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition-colors duration-150 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh prices and stock
        </button>
      </div>
    </article>
  );
}
