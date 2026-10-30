import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Search, Store } from 'lucide-react';
import ProductTable from '@/components/ProductTable';
import { formatCount } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { pushSelectedToShopify } from '@/lib/syncRunner';
import type { Product } from '@/lib/types';

const PAGE_SIZE = 50;

type SortOrder = 'name' | 'stock-asc' | 'stock-desc';

type Notice = { tone: 'success' | 'error'; text: string };

export default function ProductsView() {
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [vendorFilter, setVendorFilter] = useState('');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [sort, setSort] = useState<SortOrder>('name');
  const [vendorNames, setVendorNames] = useState<string[]>([]);
  const [markupPercent, setMarkupPercent] = useState(0);
  const [selectedTotal, setSelectedTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pushProgress, setPushProgress] = useState<string | null>(null);

  const refreshSelectedCount = useCallback(async () => {
    const { count } = await supabase
      .from('products')
      .select('id', { count: 'exact', head: true })
      .eq('is_selected', true);
    setSelectedTotal(count ?? 0);
  }, []);

  useEffect(() => {
    let active = true;
    Promise.all([
      supabase.from('sync_settings').select('markup_percent').eq('id', 1).maybeSingle(),
      supabase.from('vendors').select('name').order('name'),
    ]).then(([settingsRes, vendorsRes]) => {
      if (!active) return;
      if (settingsRes.data) setMarkupPercent(Number(settingsRes.data.markup_percent));
      if (vendorsRes.data) setVendorNames(vendorsRes.data.map((row) => row.name as string));
    });
    void refreshSelectedCount();
    return () => {
      active = false;
    };
  }, [refreshSelectedCount]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let active = true;
    setLoading(true);

    let filtered = supabase.from('products').select('*', { count: 'exact' });
    if (vendorFilter) filtered = filtered.eq('vendor_name', vendorFilter);
    if (selectedOnly) filtered = filtered.eq('is_selected', true);
    if (debouncedSearch) {
      const term = debouncedSearch.replace(/[,()*%]/g, ' ').trim();
      if (term) {
        filtered = filtered.or(
          `description.ilike.*${term}*,ingram_part_number.ilike.*${term}*,vendor_part_number.ilike.*${term}*`,
        );
      }
    }

    const ordered =
      sort === 'name'
        ? filtered.order('ingram_part_number')
        : filtered
            .order('total_availability', { ascending: sort === 'stock-asc', nullsFirst: false })
            .order('ingram_part_number');

    ordered
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      .then(({ data, error, count }) => {
        if (!active) return;
        if (error) {
          setNotice({ tone: 'error', text: 'Could not load products. Try again.' });
          setProducts([]);
          setTotal(0);
        } else {
          setProducts((data ?? []) as Product[]);
          setTotal(count ?? 0);
        }
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [page, vendorFilter, selectedOnly, sort, debouncedSearch, reloadKey]);

  function applyLocalSelection(ids: string[], value: boolean) {
    const idSet = new Set(ids);
    setProducts((current) =>
      current.map((item) => (idSet.has(item.id) ? { ...item, is_selected: value } : item)),
    );
  }

  async function setSelection(ids: string[], value: boolean) {
    setNotice(null);
    applyLocalSelection(ids, value);
    const { error } = await supabase.from('products').update({ is_selected: value }).in('id', ids);
    if (error) {
      setNotice({ tone: 'error', text: 'Could not update the selection. Try again.' });
      setReloadKey((key) => key + 1);
    }
    void refreshSelectedCount();
  }

  async function setVendorSelection(value: boolean) {
    setNotice(null);
    const { error } = await supabase
      .from('products')
      .update({ is_selected: value })
      .eq('vendor_name', vendorFilter);
    if (error) {
      setNotice({ tone: 'error', text: 'Could not update the selection. Try again.' });
    } else {
      setNotice({
        tone: 'success',
        text: value
          ? `All ${vendorFilter} products are now selected for Shopify.`
          : `All ${vendorFilter} products were removed from the Shopify selection. Products already in Shopify stay there.`,
      });
    }
    setReloadKey((key) => key + 1);
    void refreshSelectedCount();
  }

  async function pushToShopify() {
    setNotice(null);
    setPushProgress('Starting');
    try {
      const result = await pushSelectedToShopify(setPushProgress);
      if (result.failed > 0) {
        setNotice({
          tone: 'error',
          text: `${formatCount(result.pushed)} products pushed. ${formatCount(result.failed)} could not be pushed. See the Shopify column for details.`,
        });
      } else {
        setNotice({ tone: 'success', text: `${formatCount(result.pushed)} products pushed to Shopify.` });
      }
    } catch (err) {
      setNotice({
        tone: 'error',
        text: err instanceof Error ? err.message : 'The push did not finish. Try again.',
      });
    } finally {
      setPushProgress(null);
      setReloadKey((key) => key + 1);
      void refreshSelectedCount();
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = Math.min(total, page * PAGE_SIZE + products.length);
  const allOnPageChecked = products.length > 0 && products.every((product) => product.is_selected);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Products</h1>
          <p className="mt-1 text-sm text-slate-500">
            Choose which products appear in your Shopify store. Stock for products already in Shopify is checked
            against Ingram Micro automatically; price changes show as "Needs update" until you push again.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void pushToShopify()}
          disabled={selectedTotal === 0 || pushProgress !== null}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors duration-150 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {pushProgress !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Store className="h-4 w-4" />}
          Push {formatCount(selectedTotal)} to Shopify
        </button>
      </div>

      {pushProgress !== null && (
        <div className="flex items-center gap-2 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700">
          <Loader2 className="h-4 w-4 animate-spin" /> {pushProgress}
        </div>
      )}

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

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name or part number"
            className="w-full rounded-lg border border-slate-300 py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <select
          value={vendorFilter}
          onChange={(event) => {
            setVendorFilter(event.target.value);
            setPage(0);
          }}
          className="rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-8 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
        >
          <option value="">All vendors</option>
          {vendorNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label="Sort products"
          value={sort}
          onChange={(event) => {
            setSort(event.target.value as SortOrder);
            setPage(0);
          }}
          className="rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-8 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
        >
          <option value="name">Sort: Part number</option>
          <option value="stock-asc">Sort: Stock, lowest first</option>
          <option value="stock-desc">Sort: Stock, highest first</option>
        </select>
        <button
          type="button"
          onClick={() => {
            setSelectedOnly((value) => !value);
            setPage(0);
          }}
          aria-pressed={selectedOnly}
          className={`rounded-lg px-3.5 py-2 text-sm font-medium ring-1 ring-inset transition-colors duration-150 ${
            selectedOnly
              ? 'bg-blue-50 text-blue-700 ring-blue-200'
              : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
          }`}
        >
          Selected only
        </button>
      </div>

      {vendorFilter && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-500">All {vendorFilter} products:</span>
          <button
            type="button"
            onClick={() => void setVendorSelection(true)}
            className="rounded-md bg-white px-2.5 py-1 font-medium text-blue-700 ring-1 ring-inset ring-slate-300 transition-colors duration-150 hover:bg-blue-50"
          >
            Select all
          </button>
          <button
            type="button"
            onClick={() => void setVendorSelection(false)}
            className="rounded-md bg-white px-2.5 py-1 font-medium text-slate-700 ring-1 ring-inset ring-slate-300 transition-colors duration-150 hover:bg-slate-50"
          >
            Deselect all
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading products
        </div>
      ) : total === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
          <p className="text-sm font-medium text-slate-900">No products match these filters</p>
          <p className="mt-1 text-sm text-slate-500">
            Import a vendor catalog from the Vendors page, or change your search.
          </p>
        </div>
      ) : (
        <>
          <ProductTable
            products={products}
            markupPercent={markupPercent}
            allChecked={allOnPageChecked}
            onToggleOne={(product) => void setSelection([product.id], !product.is_selected)}
            onToggleAll={(checked) => void setSelection(products.map((product) => product.id), checked)}
          />

          <div className="flex items-center justify-between text-sm text-slate-600">
            <p>
              Showing {formatCount(rangeStart)} to {formatCount(rangeEnd)} of {formatCount(total)}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Previous page"
                disabled={page === 0}
                onClick={() => setPage((current) => Math.max(0, current - 1))}
                className="rounded-md p-1.5 ring-1 ring-inset ring-slate-300 transition-colors duration-150 hover:bg-white disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="tabular-nums">
                {page + 1} / {pageCount}
              </span>
              <button
                type="button"
                aria-label="Next page"
                disabled={page + 1 >= pageCount}
                onClick={() => setPage((current) => current + 1)}
                className="rounded-md p-1.5 ring-1 ring-inset ring-slate-300 transition-colors duration-150 hover:bg-white disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
