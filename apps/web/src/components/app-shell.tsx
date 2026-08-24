'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Boxes,
  ChevronRight,
  CircleUserRound,
  ClipboardList,
  LogIn,
  LogOut,
  PackageSearch,
  ShoppingBag,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { cartItemCount, useCartStore } from '@/features/cart/cart-store';
import { apiHealth, apiUrl } from '@/lib/api/client';
import { userSchema } from '@/lib/api/contracts';
import { cn } from '@/lib/utils';

interface NavigationItem {
  readonly adminOnly?: boolean;
  readonly href: string;
  readonly icon: LucideIcon;
  readonly label: string;
}

const navigation: readonly NavigationItem[] = [
  { href: '/catalog/', icon: PackageSearch, label: 'Catalog' },
  { href: '/orders/', icon: ClipboardList, label: 'Orders' },
  { href: '/notifications/', icon: Bell, label: 'Notifications' },
  { adminOnly: true, href: '/admin/', icon: Boxes, label: 'Operations' },
];

function SystemStatus(): ReactNode {
  const health = useQuery({
    queryFn: ({ signal }) => apiHealth(signal),
    queryKey: ['system-health'],
    refetchInterval: 60_000,
  });

  const operational = health.data === true;

  return (
    <span className="hidden items-center gap-2 text-xs font-medium text-slate-500 lg:flex">
      <span
        aria-hidden="true"
        className={cn(
          'size-2 rounded-full',
          operational ? 'bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,.12)]' : 'bg-slate-300',
        )}
      />
      {operational ? 'Systems operational' : 'Checking systems'}
    </span>
  );
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>): ReactNode {
  const pathname = usePathname();
  const { isAdmin, logout, request, session } = useAuth();
  const cartCount = useCartStore((state) => cartItemCount(state.items));
  const identity = useQuery({
    enabled: session !== null,
    queryFn: ({ signal }) => request('/api/v1/auth/me', { schema: userSchema, signal }),
    queryKey: ['auth', 'me', session?.user.id],
    retry: false,
  });
  const currentUser = identity.data ?? session?.user;
  const visibleNavigation = navigation.filter((item) => item.adminOnly !== true || isAdmin);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link
            aria-label="Orderly home"
            className="group flex shrink-0 items-center gap-2.5"
            href="/"
          >
            <span className="grid size-9 place-items-center rounded-xl bg-slate-950 text-amber-300 transition group-hover:-rotate-3">
              <ShoppingBag aria-hidden="true" className="size-5" />
            </span>
            <span className="hidden text-lg font-bold tracking-[-0.03em] text-slate-950 sm:block">
              Orderly
            </span>
          </Link>

          <nav
            aria-label="Primary navigation"
            className="ml-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] sm:ml-4"
          >
            {visibleNavigation.map((item) => {
              const active = pathname.startsWith(item.href.replace(/\/$/u, ''));
              const Icon = item.icon;

              return (
                <Link
                  key={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition',
                    active
                      ? 'bg-slate-950 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950',
                  )}
                  href={item.href}
                >
                  <Icon aria-hidden="true" className="size-4" />
                  <span className="hidden md:inline">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <SystemStatus />

          <Link
            aria-label={`Checkout, ${String(cartCount)} items`}
            className="relative grid size-10 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-700 transition hover:bg-slate-50"
            href="/checkout/"
          >
            <ShoppingBag aria-hidden="true" className="size-4" />
            {cartCount === 0 ? null : (
              <span className="absolute -right-1.5 -top-1.5 grid min-w-5 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold leading-5 text-slate-950">
                {cartCount > 99 ? '99+' : cartCount}
              </span>
            )}
          </Link>

          {session === null ? (
            <Link className={buttonVariants({ size: 'sm' })} href="/login/">
              <LogIn aria-hidden="true" className="size-4" />
              <span className="hidden sm:inline">Demo sign in</span>
            </Link>
          ) : (
            <div className="flex items-center gap-2">
              <div className="hidden text-right xl:block">
                <p className="max-w-36 truncate text-xs font-semibold text-slate-900">
                  {currentUser?.name ?? session.user.name}
                </p>
                <p className="text-[11px] text-slate-500">
                  {isAdmin ? 'Administrator' : 'Customer'}
                </p>
              </div>
              <Button
                aria-label="Sign out"
                onClick={() => {
                  void logout();
                }}
                size="icon"
                variant="ghost"
              >
                <LogOut aria-hidden="true" className="size-4" />
              </Button>
            </div>
          )}
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <CircleUserRound aria-hidden="true" className="size-4" />
            Synthetic demo data only. No payments are charged.
          </div>
          <a
            className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-950"
            href={apiUrl('/docs')}
          >
            Explore the API <ChevronRight aria-hidden="true" className="size-4" />
          </a>
        </div>
      </footer>
    </div>
  );
}
