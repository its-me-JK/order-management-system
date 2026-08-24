import { AlertTriangle, Inbox, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface StatePanelProps {
  readonly action?: Readonly<{
    label: string;
    onClick: () => void;
  }>;
  readonly description: string;
  readonly icon?: LucideIcon;
  readonly title: string;
  readonly tone?: 'empty' | 'error';
}

export function StatePanel({
  action,
  description,
  icon,
  title,
  tone = 'empty',
}: StatePanelProps): ReactNode {
  const Icon = icon ?? (tone === 'error' ? AlertTriangle : Inbox);

  return (
    <Card
      className="flex min-h-56 flex-col items-center justify-center p-8 text-center"
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <div
        className={
          tone === 'error'
            ? 'mb-4 rounded-2xl bg-rose-50 p-3 text-rose-600'
            : 'mb-4 rounded-2xl bg-slate-100 p-3 text-slate-600'
        }
      >
        <Icon aria-hidden="true" className="size-6" />
      </div>
      <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-slate-600">{description}</p>
      {action === undefined ? null : (
        <Button className="mt-5" onClick={action.onClick} variant="outline">
          {action.label}
        </Button>
      )}
    </Card>
  );
}
