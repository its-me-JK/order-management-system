'use client';

import { useQuery } from '@tanstack/react-query';
import { Check, PackageOpen, Search, ShoppingBag } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { PageHeading } from '@/components/page-heading';
import { StatePanel } from '@/components/state-panel';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cartItemCount, useCartStore } from '@/features/cart/cart-store';
import { apiErrorMessage, apiRequest } from '@/lib/api/client';
import { availableUnits, catalogResponseSchema } from '@/lib/api/contracts';
import { cn, formatMoney } from '@/lib/utils';

function CatalogLoading(): React.ReactNode {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status">
      <span className="sr-only">Loading catalog</span>
      {Array.from({ length: 6 }, (_, index) => (
        <Card key={index} className="p-6">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="mt-5 h-7 w-3/4" />
          <Skeleton className="mt-3 h-16 w-full" />
          <Skeleton className="mt-6 h-11 w-full" />
        </Card>
      ))}
    </div>
  );
}

export default function CatalogPage(): React.ReactNode {
  const [search, setSearch] = useState('');
  const items = useCartStore((state) => state.items);
  const add = useCartStore((state) => state.add);
  const cartCount = cartItemCount(items);
  const catalog = useQuery({
    queryFn: ({ signal }) =>
      apiRequest('/api/v1/catalog/skus', { schema: catalogResponseSchema, signal }),
    queryKey: ['catalog', 'skus'],
  });
  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (needle === '') return catalog.data?.data ?? [];
    return (catalog.data?.data ?? []).filter((sku) =>
      `${sku.name} ${sku.code} ${sku.description}`.toLocaleLowerCase().includes(needle),
    );
  }, [catalog.data, search]);

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <PageHeading
        action={
          cartCount === 0 ? undefined : (
            <Link className={buttonVariants({ variant: 'secondary' })} href="/checkout/">
              <ShoppingBag className="size-4" /> Review {cartCount}{' '}
              {cartCount === 1 ? 'item' : 'items'}
            </Link>
          )
        }
        eyebrow="Live catalog"
        subtitle="Availability is checked again at checkout. Adding an item here never reserves stock."
        title="Find something worth shipping."
      />
      <div className="relative mb-7 max-w-xl">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400"
        />
        <Input
          aria-label="Search catalog"
          className="pl-10"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, code, or description"
          type="search"
          value={search}
        />
      </div>

      {catalog.isPending ? <CatalogLoading /> : null}
      {catalog.isError ? (
        <StatePanel
          action={{
            label: 'Try again',
            onClick: () => {
              void catalog.refetch();
            },
          }}
          description={apiErrorMessage(catalog.error)}
          title="Catalog unavailable"
          tone="error"
        />
      ) : null}
      {catalog.isSuccess && filtered.length === 0 ? (
        <StatePanel
          description={
            search === ''
              ? 'No active SKUs are available right now.'
              : `No catalog item matches “${search}”.`
          }
          icon={PackageOpen}
          title="Nothing found"
        />
      ) : null}

      {filtered.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">
          {filtered.map((sku) => {
            const available = availableUnits(sku.available);
            const inCart = items.find((item) => item.skuId === sku.id)?.quantity ?? 0;
            return (
              <Card
                key={sku.id}
                className="group flex flex-col overflow-hidden transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-xl"
              >
                <div className="flex h-36 items-end justify-between bg-[radial-gradient(circle_at_25%_20%,#fde68a,transparent_28%),linear-gradient(135deg,#f8fafc,#e2e8f0)] p-5">
                  <span className="grid size-12 place-items-center rounded-2xl border border-white/70 bg-white/80 text-slate-700 shadow-sm">
                    <PackageOpen className="size-6" />
                  </span>
                  <Badge
                    variant={available === 0 ? 'danger' : available <= 5 ? 'warning' : 'success'}
                  >
                    {available === 0
                      ? 'Out of stock'
                      : typeof sku.available === 'boolean'
                        ? 'Available'
                        : `${String(available)} available`}
                  </Badge>
                </div>
                <CardHeader className="pb-3">
                  <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                    {sku.code}
                  </p>
                  <CardTitle className="mt-2">{sku.name}</CardTitle>
                  <p className="line-clamp-2 min-h-12 text-sm leading-6 text-slate-600">
                    {sku.description}
                  </p>
                </CardHeader>
                <CardContent className="mt-auto flex items-center justify-between gap-4 pt-1">
                  <div>
                    <p className="text-lg font-bold text-slate-950">
                      {formatMoney(sku.price, sku.currency)}
                    </p>
                    {inCart > 0 ? (
                      <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-emerald-700">
                        <Check className="size-3" /> {inCart} in cart
                      </p>
                    ) : null}
                  </div>
                  <Button
                    aria-label={`Add ${sku.name} to cart`}
                    disabled={available === 0 || inCart >= available}
                    onClick={() => add(sku)}
                    size="sm"
                    variant={inCart > 0 ? 'outline' : 'default'}
                  >
                    <ShoppingBag className="size-4" /> Add
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}

      <p
        className={cn('mt-8 text-center text-xs text-slate-500', filtered.length === 0 && 'hidden')}
      >
        Prices and availability are synthetic and exist only for this showcase.
      </p>
    </section>
  );
}
