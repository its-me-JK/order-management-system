import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppShell } from '@/components/app-shell';

import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  description: 'A live showcase of reliable order, inventory, and fulfillment workflows.',
  title: {
    default: 'Orderly — Distributed Order Management',
    template: '%s · Orderly',
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  return (
    <html lang="en">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
