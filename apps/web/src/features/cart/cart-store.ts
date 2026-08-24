'use client';

import { create } from 'zustand';

import { availableUnits, type CatalogSku } from '@/lib/api/contracts';

export interface CartItem {
  readonly available: number;
  readonly code: string;
  readonly currency: string;
  readonly name: string;
  readonly quantity: number;
  readonly skuId: string;
  readonly unitPrice: number;
}

interface CartState {
  readonly items: readonly CartItem[];
  readonly add: (sku: CatalogSku) => void;
  readonly clear: () => void;
  readonly remove: (skuId: string) => void;
  readonly setQuantity: (skuId: string, quantity: number) => void;
}

function boundedQuantity(quantity: number, available: number): number {
  return Math.min(Math.max(Math.trunc(quantity), 1), available);
}

export const useCartStore = create<CartState>((set) => ({
  items: [],
  add: (sku): void => {
    const available = availableUnits(sku.available);

    if (available === 0) {
      return;
    }

    set((state) => {
      const existing = state.items.find((item) => item.skuId === sku.id);

      if (existing !== undefined) {
        return {
          items: state.items.map((item) =>
            item.skuId === sku.id
              ? { ...item, quantity: boundedQuantity(item.quantity + 1, available) }
              : item,
          ),
        };
      }

      return {
        items: [
          ...state.items,
          {
            available,
            code: sku.code,
            currency: sku.currency,
            name: sku.name,
            quantity: 1,
            skuId: sku.id,
            unitPrice: sku.price,
          },
        ],
      };
    });
  },
  clear: (): void => set({ items: [] }),
  remove: (skuId): void =>
    set((state) => ({ items: state.items.filter((item) => item.skuId !== skuId) })),
  setQuantity: (skuId, quantity): void =>
    set((state) => ({
      items: state.items.map((item) =>
        item.skuId === skuId
          ? { ...item, quantity: boundedQuantity(quantity, item.available) }
          : item,
      ),
    })),
}));

export function cartItemCount(items: readonly CartItem[]): number {
  return items.reduce((total, item) => total + item.quantity, 0);
}

export function cartTotal(items: readonly CartItem[]): number {
  return items.reduce((total, item) => total + item.unitPrice * item.quantity, 0);
}
