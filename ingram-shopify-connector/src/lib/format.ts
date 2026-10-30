export function formatMoney(value: number | null, currency = 'USD'): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

export function sellingPrice(cost: number | null, markupPercent: number): number | null {
  if (cost === null) return null;
  return Math.round(cost * (1 + markupPercent / 100) * 100) / 100;
}
