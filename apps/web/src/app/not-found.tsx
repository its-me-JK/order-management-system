import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function NotFound(): React.ReactNode {
  return (
    <section className="mx-auto grid min-h-[65vh] max-w-3xl place-items-center px-4 py-16 text-center">
      <div>
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-amber-700">404</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight text-slate-950">
          That route left the warehouse.
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-slate-600">
          The page does not exist, but your order data is safe. Return to the catalog to continue.
        </p>
        <Link className={cn(buttonVariants(), 'mt-7')} href="/catalog/">
          <ArrowLeft aria-hidden="true" className="size-4" /> Return to catalog
        </Link>
      </div>
    </section>
  );
}
