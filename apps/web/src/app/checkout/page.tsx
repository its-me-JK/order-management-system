'use client';

import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Minus, PackageCheck, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { PageHeading } from '@/components/page-heading';
import { SignInRequired } from '@/components/sign-in-required';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/auth-provider';
import { cartTotal, useCartStore } from '@/features/cart/cart-store';
import { apiErrorMessage } from '@/lib/api/client';
import { orderResponseSchema, type ShippingAddress } from '@/lib/api/contracts';
import { formatMoney } from '@/lib/utils';

const initialAddress: ShippingAddress = {
  city: 'Bengaluru',
  country: 'IN',
  line1: '42 Demo Avenue',
  postalCode: '560001',
  state: 'Karnataka',
};

export default function CheckoutPage(): React.ReactNode {
  const { request, session } = useAuth();
  const items = useCartStore((state) => state.items);
  const clear = useCartStore((state) => state.clear);
  const remove = useCartStore((state) => state.remove);
  const setQuantity = useCartStore((state) => state.setQuantity);
  const [address, setAddress] = useState(initialAddress);
  const [idempotencyKey] = useState(() => globalThis.crypto.randomUUID());
  const total = cartTotal(items);
  const currency = items[0]?.currency ?? 'INR';
  const mixedCurrencies = items.some((item) => item.currency !== currency);
  const createOrder = useMutation({
    mutationFn: () =>
      request('/api/v1/orders', {
        body: {
          items: items.map((item) => ({ quantity: item.quantity, skuId: item.skuId })),
          shippingAddress: address,
        },
        idempotencyKey,
        method: 'POST',
        schema: orderResponseSchema,
      }),
    onSuccess: clear,
  });

  function updateAddress(field: keyof ShippingAddress, value: string): void {
    setAddress((current) => ({
      ...current,
      [field]: field === 'country' ? value.toUpperCase().slice(0, 2) : value,
    }));
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    createOrder.mutate();
  }

  if (session === null) {
    return (
      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <PageHeading
          eyebrow="Checkout"
          subtitle="Authentication is required before inventory can be reserved."
          title="Complete your order."
        />
        <SignInRequired description="Sign in with the customer demo account to place an idempotent order." />
      </section>
    );
  }

  if (createOrder.data !== undefined) {
    const order = createOrder.data.data;

    return (
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <Card className="p-8 text-center sm:p-12">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
            <CheckCircle2 aria-hidden="true" className="size-7" />
          </span>
          <p className="mt-6 text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">
            Order accepted
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
            {order.orderNumber}
          </h1>
          <p className="mt-3 text-slate-600">
            Inventory is reserved and the order workflow has started.
          </p>
          <p className="mt-5 text-xl font-bold text-slate-950">
            {formatMoney(order.total, order.currency)}
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <Link
              className={buttonVariants()}
              href={`/orders/?orderId=${encodeURIComponent(order.id)}`}
            >
              Track this order
            </Link>
            <Link className={buttonVariants({ variant: 'outline' })} href="/catalog/">
              Continue shopping
            </Link>
          </div>
        </Card>
      </section>
    );
  }

  if (items.length === 0) {
    return (
      <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6 lg:px-8">
        <PageHeading
          eyebrow="Checkout"
          subtitle="Your cart is held only for this browser tab."
          title="Your cart is empty."
        />
        <Card className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-600">
            <PackageCheck className="size-6" />
          </span>
          <h2 className="mt-5 text-xl font-semibold">Start with the live catalog</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">
            Choose an available SKU. Stock will be validated and reserved atomically when the order
            is created.
          </p>
          <Link className={buttonVariants({ className: 'mt-6' })} href="/catalog/">
            Browse catalog
          </Link>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      <PageHeading
        eyebrow="Checkout"
        subtitle="One request, one idempotency key, and an atomic inventory reservation."
        title="Review and place your order."
      />
      <form className="grid items-start gap-6 lg:grid-cols-[1.15fr_.85fr]" onSubmit={submit}>
        <div className="space-y-4">
          <Link
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-slate-950"
            href="/catalog/"
          >
            <ArrowLeft className="size-4" /> Back to catalog
          </Link>
          {items.map((item) => (
            <Card key={item.skuId} className="p-5">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-amber-100 text-sm font-bold text-amber-900">
                  {item.code.slice(0, 2)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-950">{item.name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {item.code} · {formatMoney(item.unitPrice, item.currency)} each
                  </p>
                </div>
                <div className="flex items-center gap-1 rounded-xl border border-slate-200 p-1">
                  <Button
                    aria-label={`Decrease ${item.name} quantity`}
                    disabled={item.quantity <= 1}
                    onClick={() => setQuantity(item.skuId, item.quantity - 1)}
                    size="icon"
                    variant="ghost"
                  >
                    <Minus className="size-4" />
                  </Button>
                  <Input
                    aria-label={`${item.name} quantity`}
                    className="h-9 w-14 border-0 px-1 text-center shadow-none focus-visible:ring-0"
                    max={item.available}
                    min={1}
                    onChange={(event) => setQuantity(item.skuId, Number(event.target.value))}
                    type="number"
                    value={item.quantity}
                  />
                  <Button
                    aria-label={`Increase ${item.name} quantity`}
                    disabled={item.quantity >= item.available}
                    onClick={() => setQuantity(item.skuId, item.quantity + 1)}
                    size="icon"
                    variant="ghost"
                  >
                    <Plus className="size-4" />
                  </Button>
                </div>
                <p className="min-w-24 text-right font-bold text-slate-950">
                  {formatMoney(item.unitPrice * item.quantity, item.currency)}
                </p>
                <Button
                  aria-label={`Remove ${item.name}`}
                  onClick={() => remove(item.skuId)}
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 className="size-4 text-rose-600" />
                </Button>
              </div>
            </Card>
          ))}
        </div>

        <Card className="lg:sticky lg:top-24">
          <CardHeader>
            <CardTitle>Shipping details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block text-sm font-semibold text-slate-800">
              Address line
              <Input
                className="mt-2"
                maxLength={180}
                onChange={(event) => updateAddress('line1', event.target.value)}
                required
                value={address.line1}
              />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-semibold text-slate-800">
                City
                <Input
                  className="mt-2"
                  maxLength={100}
                  onChange={(event) => updateAddress('city', event.target.value)}
                  required
                  value={address.city}
                />
              </label>
              <label className="block text-sm font-semibold text-slate-800">
                State
                <Input
                  className="mt-2"
                  maxLength={100}
                  onChange={(event) => updateAddress('state', event.target.value)}
                  required
                  value={address.state}
                />
              </label>
              <label className="block text-sm font-semibold text-slate-800">
                Postal code
                <Input
                  className="mt-2"
                  maxLength={20}
                  onChange={(event) => updateAddress('postalCode', event.target.value)}
                  required
                  value={address.postalCode}
                />
              </label>
              <label className="block text-sm font-semibold text-slate-800">
                Country code
                <Input
                  className="mt-2 uppercase"
                  maxLength={2}
                  minLength={2}
                  onChange={(event) => updateAddress('country', event.target.value)}
                  required
                  value={address.country}
                />
              </label>
            </div>
            <div className="border-t border-slate-200 pt-4">
              <div className="flex items-center justify-between text-sm text-slate-600">
                <span>Items</span>
                <span>{items.reduce((sum, item) => sum + item.quantity, 0)}</span>
              </div>
              <div className="mt-3 flex items-center justify-between text-lg font-bold text-slate-950">
                <span>Total</span>
                <span>{formatMoney(total, currency)}</span>
              </div>
            </div>
            {mixedCurrencies ? (
              <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">
                Items with different currencies cannot share an order.
              </p>
            ) : null}
            {createOrder.isError ? (
              <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">
                {apiErrorMessage(createOrder.error)}
              </p>
            ) : null}
            <Button
              className="w-full"
              disabled={createOrder.isPending || mixedCurrencies}
              size="lg"
              type="submit"
            >
              {createOrder.isPending ? 'Placing order…' : 'Place order'}
            </Button>
            <p className="text-center text-xs leading-5 text-slate-500">
              This showcase uses synthetic orders. No payment method is collected or charged.
            </p>
          </CardContent>
        </Card>
      </form>
    </section>
  );
}
