import { randomUUID } from 'node:crypto';

import type { EventEnvelope, MessageDisposition } from '@oms/messaging';
import { Prisma, type PrismaClient } from '@oms/database/prisma';

import { InvalidWorkerMessageError, parseOrderEventPayload } from './consumer-payload';

const CONSUMER_NAME = 'notification-worker';

class InvalidNotificationStateError extends Error {}

export class NotificationConsumerError extends Error {
  public constructor() {
    super('Notification consumer failed');
    this.name = 'NotificationConsumerError';
  }
}

function notificationCopy(
  eventType: string,
  orderNumber: string,
): Readonly<{ message: string; title: string }> {
  switch (eventType) {
    case 'order.created':
      return { message: `Order ${orderNumber} was placed.`, title: 'Order placed' };
    case 'order.cancelled':
      return { message: `Order ${orderNumber} was cancelled.`, title: 'Order cancelled' };
    case 'order.shipped':
      return { message: `Order ${orderNumber} has shipped.`, title: 'Order shipped' };
    case 'order.delivered':
      return { message: `Order ${orderNumber} was delivered.`, title: 'Order delivered' };
    case 'payment.authorized':
      return {
        message: `Payment for order ${orderNumber} was authorized.`,
        title: 'Payment successful',
      };
    case 'payment.failed':
      return {
        message: `Payment for order ${orderNumber} failed. Reserved stock was released.`,
        title: 'Payment failed',
      };
    case 'payment.refunded':
      return {
        message: `Payment for order ${orderNumber} was refunded.`,
        title: 'Payment refunded',
      };
    default:
      return { message: `Order ${orderNumber} was updated.`, title: 'Order update' };
  }
}

export class NotificationEventConsumer {
  public constructor(private readonly client: PrismaClient) {}

  public async handle(event: EventEnvelope): Promise<MessageDisposition> {
    if (!event.type.startsWith('order.') && !event.type.startsWith('payment.')) {
      return 'dead-letter';
    }

    let payload: ReturnType<typeof parseOrderEventPayload>;

    try {
      payload = parseOrderEventPayload(event.payload);
    } catch (error: unknown) {
      if (error instanceof InvalidWorkerMessageError) {
        return 'dead-letter';
      }

      throw new NotificationConsumerError();
    }

    try {
      await this.client.$transaction(
        async (transaction): Promise<void> => {
          const claim = await transaction.processedMessageRecord.createMany({
            data: [{ consumer: CONSUMER_NAME, messageId: event.id }],
            skipDuplicates: true,
          });

          if (claim.count === 0) {
            return;
          }

          const order = await transaction.orderRecord.findUnique({
            select: { id: true, orderNumber: true, userId: true },
            where: { id: payload.orderId },
          });

          if (order === null || (payload.userId !== undefined && payload.userId !== order.userId)) {
            throw new InvalidNotificationStateError();
          }

          const copy = notificationCopy(event.type, order.orderNumber);

          await transaction.notificationRecord.createMany({
            data: [
              {
                channel: 'IN_APP',
                eventId: event.id,
                id: randomUUID(),
                message: copy.message,
                orderId: order.id,
                title: copy.title,
                type: event.type,
                userId: order.userId,
              },
            ],
            skipDuplicates: true,
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          maxWait: 5_000,
          timeout: 10_000,
        },
      );

      return 'ack';
    } catch (error: unknown) {
      if (error instanceof InvalidNotificationStateError) {
        return 'dead-letter';
      }

      throw new NotificationConsumerError();
    }
  }
}
