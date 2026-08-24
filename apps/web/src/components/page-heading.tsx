import type { ReactNode } from 'react';

interface PageHeadingProps {
  readonly action?: ReactNode;
  readonly eyebrow: string;
  readonly subtitle: string;
  readonly title: string;
}

export function PageHeading({ action, eyebrow, subtitle, title }: PageHeadingProps): ReactNode {
  return (
    <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-700">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-[-0.03em] text-slate-950 sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 text-base leading-7 text-slate-600">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
