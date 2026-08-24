import { Suspense, type ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

import { OrdersScreen } from './orders-screen';

function OrdersFallback(): ReactNode {
  return (
    <section
      aria-label="Loading orders"
      className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8"
      role="status"
    >
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-3 h-10 w-72" />
      <div className="mt-10 grid gap-6 lg:grid-cols-[.8fr_1.2fr]">
        <Card className="h-80 animate-pulse bg-slate-100" />
        <Card className="h-96 animate-pulse bg-slate-100" />
      </div>
    </section>
  );
}

export default function OrdersPage(): ReactNode {
  return (
    <Suspense fallback={<OrdersFallback />}>
      <OrdersScreen />
    </Suspense>
  );
}
