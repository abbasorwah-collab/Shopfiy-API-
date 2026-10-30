import type { Tone } from '@/components/StatusPill';
import type { Product } from '@/lib/types';

export function shopifyStatusFor(product: Product): { label: string; tone: Tone } {
  if (!product.is_selected) return { label: 'Not selected', tone: 'neutral' };
  if (product.shopify_error) return { label: 'Needs attention', tone: 'danger' };
  if (!product.shopify_synced_at) return { label: 'Waiting to push', tone: 'warning' };
  if (
    product.pricing_updated_at &&
    Date.parse(product.pricing_updated_at) > Date.parse(product.shopify_synced_at)
  ) {
    return { label: 'Needs update', tone: 'warning' };
  }
  return { label: 'Live on Shopify', tone: 'success' };
}
