'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, ChevronRight, ClipboardList, MapPin, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { PageHeading } from '@/components/page-heading';
import { SignInRequired } from '@/components/sign-in-required';
import { StatePanel } from '@/components/state-panel';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/auth-provider';
import { apiErrorMessage } from '@/lib/api/client';
import { orderResponseSchema, ordersResponseSchema, type Order } from '@/lib/api/contracts';
import { cn, formatDateTime, formatMoney, humanizeStatus } from '@/lib/utils';

function statusVariant(status: string): BadgeProps['variant'] {
  if (['DELIVERED', 'AUTHORIZED', 'CONFIRMED'].includes(status)) return 'success';
  if (['CANCELLED', 'PAYMENT_FAILED', 'FAILED'].includes(status)) return 'danger';
  if (['PENDING', 'PENDING_PAYMENT', 'PROCESSING'].includes(status)) return 'warning';
  if (status === 'SHIPPED') return 'info';
  return 'neutral';
}

function canCancel(status: string): boolean {
  return ['PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING'].includes(status);
}

function OrdersLoading(): React.ReactNode {
  return (
    <div className="space-y-3" role="status">
      <span className="sr-only">Loading orders</span>
      {Array.from({ length: 3 }, (_, index) => (
        <Card key={index} className="p-5">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="mt-3 h-4 w-full" />
          <Skeleton className="mt-5 h-8 w-24" />
        </Card>
      ))}
    </div>
  );
}

function OrderDetails({
  order,
  cancelling,
  onCancel,
}: Readonly<{ order: Order; cancelling: boolean; onCancel: () => void }>): React.ReactNode {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-slate-200 bg-slate-50/70">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Order</p>
            <CardTitle className="mt-1 text-xl">{order.orderNumber}</CardTitle>
            <p className="mt-2 text-xs text-slate-500">Placed {formatDateTime(order.createdAt)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={statusVariant(order.status)}>{humanizeStatus(order.status)}</Badge>
            <Badge variant={statusVariant(order.paymentStatus)}>
              Payment {humanizeStatus(order.paymentStatus)}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-7 pt-6">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">Items</h3>
          <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {order.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-4 p-4 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{item.skuName}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.skuCode} · {item.quantity} × {formatMoney(item.unitPrice, order.currency)}
                  </p>
                </div>
                <p className="font-bold text-slate-950">
                  {formatMoney(item.lineTotal, order.currency)}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between text-lg font-bold">
            <span>Total</span>
            <span>{formatMoney(order.total, order.currency)}</span>
          </div>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <MapPin className="size-4" /> Shipping address
            </h3>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {order.shippingAddress.line1}
              <br />
              {order.shippingAddress.city}, {order.shippingAddress.state}{' '}
              {order.shippingAddress.postalCode}
              <br />
              {order.shippingAddress.country}
            </p>
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <CalendarClock className="size-4" /> Timeline
            </h3>
            <ol className="mt-4 space-y-0">
              {order.timeline.map((entry, index) => (
                <li key={entry.id} className="relative flex gap-3 pb-5 last:pb-0">
                  <span
                    className={cn(
                      'relative z-10 mt-1.5 size-2.5 shrink-0 rounded-full',
                      index === order.timeline.length - 1 ? 'bg-amber-500' : 'bg-slate-300',
                    )}
                  />
                  {index === order.timeline.length - 1 ? null : (
                    <span
                      aria-hidden="true"
                      className="absolute left-[4px] top-4 h-full w-px bg-slate-200"
                    />
                  )}
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {humanizeStatus(entry.toStatus)}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{formatDateTime(entry.createdAt)}</p>
                    {entry.reason === null ? null : (
                      <p className="mt-1 text-xs leading-5 text-slate-600">{entry.reason}</p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {canCancel(order.status) ? (
          <div className="border-t border-slate-200 pt-5">
            <Button disabled={cancelling} onClick={onCancel} variant="destructive">
              <XCircle className="size-4" /> {cancelling ? 'Cancelling…' : 'Cancel order'}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function OrdersScreen(): React.ReactNode {
  const parameters = useSearchParams();
  const selectedId = parameters.get('orderId');
  const queryClient = useQueryClient();
  const { request, session } = useAuth();
  const orders = useQuery({
    enabled: session !== null,
    queryFn: ({ signal }) => request('/api/v1/orders', { schema: ordersResponseSchema, signal }),
    queryKey: ['orders'],
  });
  const selected = useQuery({
    enabled: session !== null && selectedId !== null,
    queryFn: ({ signal }) =>
      request(`/api/v1/orders/${encodeURIComponent(selectedId ?? '')}`, {
        schema: orderResponseSchema,
        signal,
      }),
    queryKey: ['orders', selectedId],
  });
  const cancelOrder = useMutation({
    mutationFn: (orderId: string) =>
      request(`/api/v1/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: 'POST',
        schema: orderResponseSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  if (session === null) {
    return (
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <PageHeading
          eyebrow="Order history"
          subtitle="Track order and payment state from one authoritative view."
          title="Your orders."
        />
        <SignInRequired description="Sign in to inspect order history, status transitions, and delivery progress." />
      </section>
    );
  }

  const orderList = orders.data?.data ?? [];
  const effectiveId = selectedId ?? orderList[0]?.id ?? null;
  const inlineOrder =
    effectiveId === selectedId
      ? selected.data?.data
      : orderList.find((order) => order.id === effectiveId);

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <PageHeading
        action={
          <Link className={buttonVariants({ variant: 'secondary' })} href="/catalog/">
            Create an order
          </Link>
        }
        eyebrow="Order history"
        subtitle="Every state change is explicit, auditable, and visible in its timeline."
        title="Your orders."
      />
      {orders.isPending ? <OrdersLoading /> : null}
      {orders.isError ? (
        <StatePanel
          action={{
            label: 'Try again',
            onClick: () => {
              void orders.refetch();
            },
          }}
          description={apiErrorMessage(orders.error)}
          title="Orders unavailable"
          tone="error"
        />
      ) : null}
      {orders.isSuccess && orderList.length === 0 ? (
        <StatePanel
          description="Your completed checkout will appear here with its full lifecycle."
          icon={ClipboardList}
          title="No orders yet"
        />
      ) : null}
      {orderList.length > 0 ? (
        <div className="grid items-start gap-6 lg:grid-cols-[.72fr_1.28fr]">
          <div className="space-y-3">
            {orderList.map((order) => {
              const active = order.id === effectiveId;
              return (
                <Link
                  key={order.id}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'block rounded-2xl border bg-white p-5 transition',
                    active
                      ? 'border-amber-400 shadow-md'
                      : 'border-slate-200 hover:border-slate-300',
                  )}
                  href={`/orders/?orderId=${encodeURIComponent(order.id)}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-950">{order.orderNumber}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatDateTime(order.createdAt)}
                      </p>
                    </div>
                    <ChevronRight className="size-4 text-slate-400" />
                  </div>
                  <div className="mt-4 flex items-end justify-between gap-3">
                    <Badge variant={statusVariant(order.status)}>
                      {humanizeStatus(order.status)}
                    </Badge>
                    <p className="font-bold">{formatMoney(order.total, order.currency)}</p>
                  </div>
                </Link>
              );
            })}
          </div>
          <div>
            {selectedId !== null && selected.isPending ? (
              <Card aria-label="Loading order details" className="p-6" role="status">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="mt-8 h-64 w-full" />
              </Card>
            ) : null}
            {selectedId !== null && selected.isError ? (
              <StatePanel
                action={{
                  label: 'Try again',
                  onClick: () => {
                    void selected.refetch();
                  },
                }}
                description={apiErrorMessage(selected.error)}
                title="Order details unavailable"
                tone="error"
              />
            ) : null}
            {inlineOrder === undefined ? null : (
              <OrderDetails
                cancelling={cancelOrder.isPending}
                onCancel={() => cancelOrder.mutate(inlineOrder.id)}
                order={inlineOrder}
              />
            )}
            {cancelOrder.isError ? (
              <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">
                {apiErrorMessage(cancelOrder.error)}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
