import { LockKeyhole } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';

interface SignInRequiredProps {
  readonly description: string;
}

export function SignInRequired({ description }: SignInRequiredProps): ReactNode {
  return (
    <Card className="flex min-h-72 flex-col items-center justify-center p-8 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-amber-100 text-amber-800">
        <LockKeyhole aria-hidden="true" className="size-6" />
      </span>
      <h2 className="mt-5 text-xl font-semibold text-slate-950">Sign in to continue</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">{description}</p>
      <Link className={buttonVariants({ className: 'mt-6' })} href="/login/">
        Choose a demo account
      </Link>
    </Card>
  );
}
