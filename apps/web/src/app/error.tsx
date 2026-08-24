'use client';

import { RotateCcw } from 'lucide-react';
import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

export default function ErrorPage({
  error,
  reset,
}: Readonly<{ error: Error & { digest?: string }; reset: () => void }>): React.ReactNode {
  useEffect(() => {
    // Error details are deliberately not rendered into the browser UI.
    void error.digest;
  }, [error]);

  return (
    <section className="mx-auto grid min-h-[65vh] max-w-3xl place-items-center px-4 py-16 text-center">
      <div>
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-rose-600">
          Unexpected error
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-950">
          This screen could not be loaded.
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-slate-600">
          No action was repeated automatically. Try loading this screen again when you are ready.
        </p>
        <Button className="mt-7" onClick={reset}>
          <RotateCcw aria-hidden="true" className="size-4" /> Try again
        </Button>
      </div>
    </section>
  );
}
