import { beforeEach, describe, expect, it } from 'vitest';

import type { CatalogSku } from '@/lib/api/contracts';

import { cartItemCount, cartTotal, useCartStore } from './cart-store';

const sku: CatalogSku = {
  available: 2,
  code: 'DEMO-001',
  currency: 'INR',
  description: 'Demo SKU',
  id: 'sku-1',
  name: 'Demo item',
  price: 125,
};

describe('cart store', () => {
  beforeEach(() => useCartStore.getState().clear());

  it('caps quantities at current availability and derives totals', () => {
    useCartStore.getState().add(sku);
    useCartStore.getState().add(sku);
    useCartStore.getState().add(sku);

    const { items } = useCartStore.getState();

    expect(items).toHaveLength(1);
    expect(cartItemCount(items)).toBe(2);
    expect(cartTotal(items)).toBe(250);
  });

  it('does not add unavailable stock', () => {
    useCartStore.getState().add({ ...sku, available: false });

    expect(useCartStore.getState().items).toEqual([]);
  });
});
