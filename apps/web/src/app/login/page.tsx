'use client';

import { useMutation } from '@tanstack/react-query';
import { ArrowRight, KeyRound, ShieldCheck, UserRoundCog } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { PageHeading } from '@/components/page-heading';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/auth-provider';
import { apiErrorMessage } from '@/lib/api/client';

const demoAccounts = [
  { email: 'customer@oms.local', label: 'Customer', password: 'Customer123!', icon: KeyRound },
  { email: 'admin@oms.local', label: 'Administrator', password: 'Admin123!', icon: UserRoundCog },
] as const;

export default function LoginPage(): React.ReactNode {
  const router = useRouter();
  const { isAdmin, login, session } = useAuth();
  const [email, setEmail] = useState<string>(demoAccounts[0].email);
  const [password, setPassword] = useState<string>(demoAccounts[0].password);
  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (user) => {
      const admin = user.role === 'ADMIN' || user.roles.includes('ADMIN');
      router.push(admin ? '/admin/' : '/catalog/');
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    mutation.mutate({ email: email.trim(), password });
  }

  if (session !== null) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <Card className="p-8 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
            <ShieldCheck className="size-6" />
          </span>
          <h1 className="mt-5 text-2xl font-bold">You are signed in as {session.user.name}.</h1>
          <p className="mt-2 text-slate-600">
            Your access credentials live only in this browser tab&apos;s memory.
          </p>
          <Button className="mt-6" onClick={() => router.push(isAdmin ? '/admin/' : '/catalog/')}>
            Continue <ArrowRight className="size-4" />
          </Button>
        </Card>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
      <PageHeading
        eyebrow="Demo access"
        subtitle="Choose a synthetic role, inspect the credentials, and enter the same workflow a real client would use."
        title="Step inside the order system."
      />
      <div className="grid gap-6 lg:grid-cols-[.9fr_1.1fr]">
        <div className="space-y-3">
          {demoAccounts.map((account) => {
            const Icon = account.icon;
            const selected = email === account.email;
            return (
              <button
                key={account.email}
                aria-pressed={selected}
                className={`w-full rounded-2xl border p-5 text-left transition ${selected ? 'border-amber-400 bg-amber-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                onClick={() => {
                  setEmail(account.email);
                  setPassword(account.password);
                }}
                type="button"
              >
                <span className="flex items-start gap-4">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-slate-950 text-amber-300">
                    <Icon aria-hidden="true" className="size-5" />
                  </span>
                  <span>
                    <span className="font-semibold text-slate-950">{account.label} workspace</span>
                    <span className="mt-1 block text-sm text-slate-600">{account.email}</span>
                    <span className="mt-1 block text-xs font-medium text-slate-400">
                      Password: {account.password}
                    </span>
                  </span>
                </span>
              </button>
            );
          })}
          <p className="px-1 pt-2 text-xs leading-5 text-slate-500">
            These accounts contain synthetic showcase data. Credentials are deliberately public and
            grant no access outside this environment.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in securely</CardTitle>
            <CardDescription>
              Refresh credentials use a host-only cookie. Access tokens are kept only in memory; the
              CSRF token is scoped to this browser tab so reloads remain signed in.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-5" onSubmit={submit}>
              <label className="block text-sm font-semibold text-slate-800">
                Email
                <Input
                  className="mt-2"
                  autoComplete="email"
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  type="email"
                  value={email}
                />
              </label>
              <label className="block text-sm font-semibold text-slate-800">
                Password
                <Input
                  className="mt-2"
                  autoComplete="current-password"
                  minLength={8}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </label>
              {mutation.isError ? (
                <p
                  className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700"
                  role="alert"
                >
                  {apiErrorMessage(mutation.error)}
                </p>
              ) : null}
              <Button className="w-full" disabled={mutation.isPending} size="lg" type="submit">
                {mutation.isPending ? 'Signing in…' : 'Enter workspace'}
                {mutation.isPending ? null : <ArrowRight aria-hidden="true" className="size-4" />}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
