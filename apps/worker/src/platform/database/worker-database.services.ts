import type { DatabaseRuntime } from '@oms/database';
import { getPrismaClient } from '@oms/database/prisma';
import type { EventHandler, MessagingRuntime } from '@oms/messaging';

import { NotificationEventConsumer } from './notification.consumer';
import { OutboxPublisher, type OutboxPublisherOptions } from './outbox.publisher';
import { PaymentEventConsumer } from './payment.consumer';

export interface WorkerDatabaseServices {
  readonly notificationHandler: EventHandler;
  readonly outboxPublisher: OutboxPublisher;
  readonly paymentHandler: EventHandler;
}

export function createWorkerDatabaseServices(
  database: DatabaseRuntime,
  messaging: MessagingRuntime,
  outboxOptions: OutboxPublisherOptions,
): WorkerDatabaseServices {
  const client = getPrismaClient(database);
  const paymentConsumer = new PaymentEventConsumer(client);
  const notificationConsumer = new NotificationEventConsumer(client);

  return Object.freeze({
    notificationHandler: notificationConsumer.handle.bind(notificationConsumer),
    outboxPublisher: new OutboxPublisher(client, messaging, outboxOptions),
    paymentHandler: paymentConsumer.handle.bind(paymentConsumer),
  });
}
