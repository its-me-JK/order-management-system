'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, PackageCheck, Send, ShieldAlert, Truck, Warehouse } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import { PageHeading } from '@/components/page-heading';
import { SignInRequired } from '@/components/sign-in-required';
import { StatePanel } from '@/components/state-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/auth-provider';
import { apiErrorMessage } from '@/lib/api/client';
import {
  inventoryItemResponseSchema,
  inventoryResponseSchema,
  orderResponseSchema,
  ordersResponseSchema,
} from '@/lib/api/contracts';
import { formatDateTime, humanizeStatus } from '@/lib/utils';

function AdminLoading(): React.ReactNode {
  return (
    <div className="grid gap-6 lg:grid-cols-2" role="status">
      <span className="sr-only">Loading operations data</span>
      <Card className="p-6">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="mt-6 h-72 w-full" />
      </Card>
      <Card className="p-6">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="mt-6 h-72 w-full" />
      </Card>
    </div>
  );
}

export default function AdminPage(): React.ReactNode {
  const queryClient = useQueryClient();
  const { isAdmin, request, session } = useAuth();
  const [inventorySelection, setInventorySelection] = useState('');
  const [quantityDelta, setQuantityDelta] = useState('0');
  const [reason, setReason] = useState('');
  const inventory = useQuery({
    enabled: isAdmin,
    queryFn: ({ signal }) =>
      request('/api/v1/inventory', { schema: inventoryResponseSchema, signal }),
    queryKey: ['inventory'],
  });
  const orders = useQuery({
    enabled: isAdmin,
    queryFn: ({ signal }) => request('/api/v1/orders', { schema: ordersResponseSchema, signal }),
    queryKey: ['orders'],
  });
  const adjustInventory = useMutation({
    mutationFn: () => {
      const selected = inventory.data?.data.find(
        (item) => `${item.skuId}:${item.warehouseId}` === inventorySelection,
      );
      if (selected === undefined) throw new Error('Select an inventory item.');
      return request(`/api/v1/inventory/${encodeURIComponent(selected.skuId)}/adjust`, {
        body: {
          quantityDelta: Number(quantityDelta),
          reason: reason.trim(),
          warehouseId: selected.warehouseId,
        },
        method: 'POST',
        schema: inventoryItemResponseSchema,
      });
    },
    onSuccess: async () => {
      setQuantityDelta('0');
      setReason('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
        queryClient.invalidateQueries({ queryKey: ['catalog'] }),
      ]);
    },
  });
  const transitionOrder = useMutation({
    mutationFn: ({ action, orderId }: Readonly<{ action: 'deliver' | 'ship'; orderId: string }>) =>
      request(`/api/v1/admin/orders/${encodeURIComponent(orderId)}/${action}`, {
        method: 'POST',
        schema: orderResponseSchema,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['inventory'] }),
      ]);
    },
  });

  function submitAdjustment(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    adjustInventory.mutate();
  }

  if (session === null) {
    return (
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <PageHeading
          eyebrow="Operations console"
          subtitle="Privileged inventory and fulfillment workflows stay behind role-based authorization."
          title="Run the operation."
        />
        <SignInRequired description="Use the administrator demo account to access inventory and fulfillment controls." />
      </section>
    );
  }

  if (!isAdmin) {
    return (
      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <PageHeading
          eyebrow="Operations console"
          subtitle="This route requires the administrator role."
          title="Run the operation."
        />
        <StatePanel
          description="Your current account can place and track orders but cannot adjust stock or advance fulfillment."
          icon={ShieldAlert}
          title="Administrator access required"
          tone="error"
        />
      </section>
    );
  }

  const stock = inventory.data?.data ?? [];
  const orderList = orders.data?.data ?? [];
  const activeOrders = orderList.filter(
    (order) => !['CANCELLED', 'DELIVERED'].includes(order.status),
  );
  const inventoryUnavailable = inventory.isError;
  const ordersUnavailable = orders.isError;

  return (
    <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <PageHeading
        eyebrow="Operations console"
        subtitle="Adjust stock deliberately, then move authorized orders through fulfillment."
        title="Run the operation."
      />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Warehouses</p>
          <p className="mt-2 text-3xl font-bold">
            {new Set(stock.map((item) => item.warehouseId)).size}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
            Available units
          </p>
          <p className="mt-2 text-3xl font-bold">
            {stock.reduce((sum, item) => sum + item.available, 0)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
            Active orders
          </p>
          <p className="mt-2 text-3xl font-bold">{activeOrders.length}</p>
        </Card>
      </div>

      {inventory.isPending || orders.isPending ? <AdminLoading /> : null}
      {inventoryUnavailable || ordersUnavailable ? (
        <StatePanel
          action={{
            label: 'Try again',
            onClick: () => {
              void Promise.all([inventory.refetch(), orders.refetch()]);
            },
          }}
          description={apiErrorMessage(inventory.error ?? orders.error)}
          title="Operations data unavailable"
          tone="error"
        />
      ) : null}
      {!inventory.isPending && !orders.isPending && !inventoryUnavailable && !ordersUnavailable ? (
        <div className="grid items-start gap-6 xl:grid-cols-[1.05fr_.95fr]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Warehouse className="size-5" /> Inventory
                </CardTitle>
                <CardDescription>
                  Reserved units cannot be removed. Each adjustment is versioned and journaled.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {stock.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-600">
                    No inventory has been seeded.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[620px] text-left text-sm">
                      <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
                        <tr>
                          <th className="pb-3 font-semibold">SKU</th>
                          <th className="pb-3 font-semibold">Warehouse</th>
                          <th className="pb-3 text-right font-semibold">On hand</th>
                          <th className="pb-3 text-right font-semibold">Reserved</th>
                          <th className="pb-3 text-right font-semibold">Available</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {stock.map((item) => (
                          <tr key={`${item.skuId}:${item.warehouseId}`}>
                            <td className="py-4">
                              <p className="font-semibold text-slate-900">{item.skuName}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                {item.skuCode} · v{item.version}
                              </p>
                            </td>
                            <td className="py-4">
                              <p>{item.warehouseName}</p>
                              <p className="mt-1 text-xs text-slate-500">{item.warehouseCode}</p>
                            </td>
                            <td className="py-4 text-right font-medium">{item.onHand}</td>
                            <td className="py-4 text-right text-amber-700">{item.reserved}</td>
                            <td className="py-4 text-right font-bold text-emerald-700">
                              {item.available}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Post an inventory adjustment</CardTitle>
                <CardDescription>
                  A reason is mandatory so operators can audit why physical stock changed.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitAdjustment}>
                  <label className="block text-sm font-semibold text-slate-800 sm:col-span-2">
                    Inventory item
                    <select
                      className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-200"
                      onChange={(event) => setInventorySelection(event.target.value)}
                      required
                      value={inventorySelection}
                    >
                      <option value="">Select a SKU and warehouse</option>
                      {stock.map((item) => (
                        <option
                          key={`${item.skuId}:${item.warehouseId}`}
                          value={`${item.skuId}:${item.warehouseId}`}
                        >
                          {item.skuCode} — {item.warehouseCode} ({item.available} available)
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm font-semibold text-slate-800">
                    Quantity delta
                    <Input
                      className="mt-2"
                      max={100000}
                      min={-100000}
                      onChange={(event) => setQuantityDelta(event.target.value)}
                      required
                      step={1}
                      type="number"
                      value={quantityDelta}
                    />
                  </label>
                  <label className="block text-sm font-semibold text-slate-800">
                    Reason
                    <Input
                      className="mt-2"
                      maxLength={240}
                      minLength={3}
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Cycle count correction"
                      required
                      value={reason}
                    />
                  </label>
                  {adjustInventory.isError ? (
                    <p
                      className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700 sm:col-span-2"
                      role="alert"
                    >
                      {apiErrorMessage(adjustInventory.error)}
                    </p>
                  ) : null}
                  {adjustInventory.isSuccess ? (
                    <p
                      className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700 sm:col-span-2"
                      role="status"
                    >
                      Inventory updated successfully.
                    </p>
                  ) : null}
                  <Button
                    className="sm:col-span-2"
                    disabled={adjustInventory.isPending || Number(quantityDelta) === 0}
                    type="submit"
                  >
                    {adjustInventory.isPending ? 'Posting adjustment…' : 'Post adjustment'}
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Boxes className="size-5" /> Fulfillment queue
              </CardTitle>
              <CardDescription>
                Only valid transitions are offered; the API enforces them again.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {activeOrders.length === 0 ? (
                <div className="rounded-xl bg-slate-50 p-6 text-center">
                  <PackageCheck className="mx-auto size-6 text-slate-400" />
                  <p className="mt-3 text-sm font-semibold">No orders require action</p>
                </div>
              ) : (
                activeOrders.map((order) => {
                  const canShip =
                    ['CONFIRMED', 'PROCESSING'].includes(order.status) &&
                    order.paymentStatus === 'AUTHORIZED';
                  const canDeliver = order.status === 'SHIPPED';
                  const working =
                    transitionOrder.isPending && transitionOrder.variables?.orderId === order.id;
                  return (
                    <div key={order.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-950">{order.orderNumber}</p>
                          <p className="mt-1 text-xs text-slate-500">
                            {formatDateTime(order.createdAt)} · {order.items.length} lines
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <Badge>{humanizeStatus(order.status)}</Badge>
                          <Badge
                            variant={order.paymentStatus === 'AUTHORIZED' ? 'success' : 'warning'}
                          >
                            {humanizeStatus(order.paymentStatus)}
                          </Badge>
                        </div>
                      </div>
                      {canShip || canDeliver ? (
                        <Button
                          className="mt-4 w-full"
                          disabled={working}
                          onClick={() =>
                            transitionOrder.mutate({
                              action: canShip ? 'ship' : 'deliver',
                              orderId: order.id,
                            })
                          }
                          variant={canDeliver ? 'secondary' : 'default'}
                        >
                          {canShip ? <Truck className="size-4" /> : <Send className="size-4" />}
                          {working ? 'Updating…' : canShip ? 'Mark shipped' : 'Mark delivered'}
                        </Button>
                      ) : (
                        <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                          Waiting for payment authorization or another system transition.
                        </p>
                      )}
                    </div>
                  );
                })
              )}
              {transitionOrder.isError ? (
                <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">
                  {apiErrorMessage(transitionOrder.error)}
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      ) : null}
    </section>
  );
}
