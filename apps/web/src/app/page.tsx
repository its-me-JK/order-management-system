import {
  ArrowRight,
  Boxes,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  PackageCheck,
  RadioTower,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const capabilities = [
  {
    description: 'Stock is reserved with explicit consistency rules before an order is confirmed.',
    icon: Boxes,
    title: 'Inventory-aware ordering',
  },
  {
    description: 'Every state change is visible as a durable, human-readable order timeline.',
    icon: PackageCheck,
    title: 'Traceable fulfillment',
  },
  {
    description:
      'Transactional outbox delivery protects events across database and broker failures.',
    icon: RadioTower,
    title: 'Reliable asynchronous work',
  },
] as const;

export default function HomePage(): React.ReactNode {
  return (
    <>
      <section className="relative overflow-hidden border-b border-slate-200/80">
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:44px_44px] opacity-30 [mask-image:linear-gradient(to_bottom,black,transparent_88%)]" />
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[1.15fr_.85fr] lg:items-center lg:px-8">
          <div>
            <Badge variant="warning">
              <span className="mr-1.5 size-1.5 rounded-full bg-amber-500" /> Live system showcase
            </Badge>
            <h1 className="mt-6 max-w-4xl text-5xl font-bold leading-[1.03] tracking-[-0.055em] text-slate-950 sm:text-6xl lg:text-7xl">
              Orders move fast.
              <span className="block text-slate-500">The system stays correct.</span>
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
              Explore a real order lifecycle—from stock-aware checkout to fulfillment—built around
              explicit consistency, idempotency, and operational visibility.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                className={buttonVariants({ size: 'lg', variant: 'secondary' })}
                href="/catalog/"
              >
                Browse live catalog <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
              <Link className={buttonVariants({ size: 'lg', variant: 'outline' })} href="/login/">
                Use a demo account
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-slate-600">
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-600" /> Synthetic data
              </span>
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-600" /> No real payment
              </span>
              <span className="inline-flex items-center gap-2">
                <CheckCircle2 className="size-4 text-emerald-600" /> Observable workflows
              </span>
            </div>
          </div>

          <Card className="relative overflow-hidden bg-slate-950 p-6 text-white sm:p-8">
            <div className="absolute -right-20 -top-20 size-56 rounded-full bg-amber-300/20 blur-3xl" />
            <div className="relative">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">
                    Order pulse
                  </p>
                  <p className="mt-2 text-2xl font-semibold">OMS-2026-1042</p>
                </div>
                <Badge className="border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
                  In transit
                </Badge>
              </div>
              <div className="mt-8 space-y-1">
                {[
                  ['Order accepted', '10:42', true],
                  ['Inventory reserved', '10:42', true],
                  ['Payment confirmed', '10:43', true],
                  ['Shipment dispatched', '11:08', true],
                  ['Delivered', 'Expected 18:00', false],
                ].map(([label, time, complete]) => (
                  <div
                    key={String(label)}
                    className="grid grid-cols-[24px_1fr_auto] items-center gap-3 py-2.5"
                  >
                    <span
                      className={cn(
                        'grid size-6 place-items-center rounded-full',
                        complete
                          ? 'bg-emerald-400 text-slate-950'
                          : 'border border-slate-600 text-slate-500',
                      )}
                    >
                      {complete ? (
                        <CheckCircle2 aria-hidden="true" className="size-3.5" />
                      ) : (
                        <Clock3 aria-hidden="true" className="size-3.5" />
                      )}
                    </span>
                    <span
                      className={
                        complete ? 'text-sm font-medium text-white' : 'text-sm text-slate-400'
                      }
                    >
                      {label}
                    </span>
                    <span className="text-xs text-slate-400">{time}</span>
                  </div>
                ))}
              </div>
              <div className="mt-6 grid grid-cols-2 gap-3 border-t border-slate-800 pt-6">
                <div className="rounded-xl bg-white/5 p-4">
                  <DatabaseZap aria-hidden="true" className="size-5 text-sky-300" />
                  <p className="mt-3 text-sm font-semibold">Durable state</p>
                  <p className="mt-1 text-xs text-slate-400">MySQL source of truth</p>
                </div>
                <div className="rounded-xl bg-white/5 p-4">
                  <ShieldCheck aria-hidden="true" className="size-5 text-amber-300" />
                  <p className="mt-3 text-sm font-semibold">Safe retries</p>
                  <p className="mt-1 text-xs text-slate-400">Idempotent commands</p>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-700">
            Under the hood
          </p>
          <h2 className="mt-3 text-3xl font-bold tracking-[-0.03em] text-slate-950">
            Built to show the hard parts.
          </h2>
          <p className="mt-3 leading-7 text-slate-600">
            This is not a dashboard mock. Each screen is backed by the same contracts, transitions,
            and failure boundaries used by the API.
          </p>
        </div>
        <div className="mt-9 grid gap-4 md:grid-cols-3">
          {capabilities.map((capability) => {
            const Icon = capability.icon;
            return (
              <Card key={capability.title} className="p-6">
                <span className="grid size-11 place-items-center rounded-xl bg-amber-100 text-amber-800">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-slate-950">{capability.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{capability.description}</p>
              </Card>
            );
          })}
        </div>
      </section>
    </>
  );
}
