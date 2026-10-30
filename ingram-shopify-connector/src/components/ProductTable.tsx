import StatusPill from '@/components/StatusPill';
import { formatCount, formatDateTime, formatMoney, sellingPrice } from '@/lib/format';
import { shopifyStatusFor } from '@/lib/productStatus';
import type { Product } from '@/lib/types';

type ProductTableProps = {
  products: Product[];
  markupPercent: number;
  allChecked: boolean;
  onToggleOne: (product: Product) => void;
  onToggleAll: (checked: boolean) => void;
};

export default function ProductTable({
  products,
  markupPercent,
  allChecked,
  onToggleOne,
  onToggleAll,
}: ProductTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="w-12 px-4 py-3">
              <input
                type="checkbox"
                aria-label="Select all products on this page"
                checked={allChecked}
                onChange={(event) => onToggleAll(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
            </th>
            <th scope="col" className="px-4 py-3">Product</th>
            <th scope="col" className="px-4 py-3 text-right">Stock</th>
            <th scope="col" className="px-4 py-3 text-right">Ingram cost</th>
            <th scope="col" className="px-4 py-3 text-right">Shopify price</th>
            <th scope="col" className="px-4 py-3">Shopify</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {products.map((product) => {
            const status = shopifyStatusFor(product);
            const price = sellingPrice(product.customer_cost, markupPercent);
            return (
              <tr key={product.id} className="transition-colors duration-150 hover:bg-slate-50">
                <td className="px-4 py-3 align-top">
                  <input
                    type="checkbox"
                    aria-label={`Include ${product.description ?? product.ingram_part_number} in Shopify sync`}
                    checked={product.is_selected}
                    onChange={() => onToggleOne(product)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                </td>
                <td className="max-w-md px-4 py-3">
                  <p className="font-medium text-slate-900">{product.description ?? 'No description'}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {product.vendor_name} · {product.ingram_part_number}
                    {product.vendor_part_number ? ` · MPN ${product.vendor_part_number}` : ''}
                  </p>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                  <span className={product.total_availability === 0 ? 'font-semibold text-red-600' : undefined}>
                    {product.total_availability === null ? '—' : formatCount(product.total_availability)}
                  </span>
                  {product.stock_error ? (
                    <p className="mt-0.5 max-w-[14rem] break-words text-xs font-normal text-red-600">
                      {product.stock_error}
                    </p>
                  ) : product.stock_checked_at ? (
                    <p className="mt-0.5 text-xs font-normal text-slate-400">
                      checked {formatDateTime(product.stock_checked_at)}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                  {formatMoney(product.customer_cost, product.currency ?? 'USD')}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-900">
                  {formatMoney(price, product.currency ?? 'USD')}
                </td>
                <td className="px-4 py-3">
                  <StatusPill tone={status.tone}>{status.label}</StatusPill>
                  {product.shopify_error && (
                    <p className="mt-1 max-w-xs break-words text-xs text-red-600">{product.shopify_error}</p>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
