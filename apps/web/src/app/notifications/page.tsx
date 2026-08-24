'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellRing, Check, MailCheck } from 'lucide-react';

import { PageHeading } from '@/components/page-heading';
import { SignInRequired } from '@/components/sign-in-required';
import { StatePanel } from '@/components/state-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/features/auth/auth-provider';
import { apiErrorMessage } from '@/lib/api/client';
import { notificationResponseSchema, notificationsResponseSchema } from '@/lib/api/contracts';
import { formatDateTime, humanizeStatus } from '@/lib/utils';

export default function NotificationsPage(): React.ReactNode {
  const queryClient = useQueryClient();
  const { request, session } = useAuth();
  const notifications = useQuery({
    enabled: session !== null,
    queryFn: ({ signal }) =>
      request('/api/v1/notifications', { schema: notificationsResponseSchema, signal }),
    queryKey: ['notifications'],
  });
  const markRead = useMutation({
    mutationFn: (notificationId: string) =>
      request(`/api/v1/notifications/${encodeURIComponent(notificationId)}/read`, {
        method: 'PATCH',
        schema: notificationResponseSchema,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  if (session === null) {
    return (
      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <PageHeading
          eyebrow="Notification center"
          subtitle="Operational events become user-visible updates through the outbox pipeline."
          title="Stay in the loop."
        />
        <SignInRequired description="Sign in to view delivery updates generated for your demo account." />
      </section>
    );
  }

  const data = notifications.data?.data ?? [];
  const unread = data.filter((notification) => notification.readAt === null).length;

  return (
    <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <PageHeading
        action={
          notifications.isSuccess ? (
            <Badge variant={unread === 0 ? 'neutral' : 'info'}>{unread} unread</Badge>
          ) : undefined
        }
        eyebrow="Notification center"
        subtitle="Order events are processed asynchronously and projected into this inbox."
        title="Stay in the loop."
      />
      {notifications.isPending ? (
        <div className="space-y-3" role="status">
          <span className="sr-only">Loading notifications</span>
          {Array.from({ length: 4 }, (_, index) => (
            <Card key={index} className="p-5">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="mt-3 h-4 w-full" />
            </Card>
          ))}
        </div>
      ) : null}
      {notifications.isError ? (
        <StatePanel
          action={{
            label: 'Try again',
            onClick: () => {
              void notifications.refetch();
            },
          }}
          description={apiErrorMessage(notifications.error)}
          title="Notifications unavailable"
          tone="error"
        />
      ) : null}
      {notifications.isSuccess && data.length === 0 ? (
        <StatePanel
          description="Order and delivery events will appear after the background worker processes them."
          icon={Bell}
          title="Your inbox is clear"
        />
      ) : null}
      {data.length > 0 ? (
        <div className="space-y-3" aria-live="polite">
          {data.map((notification) => {
            const isUnread = notification.readAt === null;
            return (
              <Card
                key={notification.id}
                className={isUnread ? 'border-sky-200 bg-sky-50/30' : undefined}
              >
                <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
                  <span
                    className={
                      isUnread
                        ? 'grid size-11 shrink-0 place-items-center rounded-xl bg-sky-100 text-sky-700'
                        : 'grid size-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500'
                    }
                  >
                    {isUnread ? <BellRing className="size-5" /> : <MailCheck className="size-5" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-slate-950">{notification.title}</h2>
                      <Badge>{humanizeStatus(notification.type)}</Badge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{notification.message}</p>
                    <p className="mt-3 text-xs text-slate-400">
                      {formatDateTime(notification.createdAt)}
                    </p>
                  </div>
                  {isUnread ? (
                    <Button
                      disabled={markRead.isPending && markRead.variables === notification.id}
                      onClick={() => markRead.mutate(notification.id)}
                      size="sm"
                      variant="outline"
                    >
                      <Check className="size-4" /> Mark read
                    </Button>
                  ) : (
                    <span className="text-xs font-semibold text-emerald-700">Read</span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}
      {markRead.isError ? (
        <p className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">
          {apiErrorMessage(markRead.error)}
        </p>
      ) : null}
    </section>
  );
}
