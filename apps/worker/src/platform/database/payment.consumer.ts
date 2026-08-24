import { createHash, randomUUID } from 'node:crypto';

import type { EventEnvelope, MessageDisposition } from '@oms/messaging';
import { Prisma, type PrismaClient } from '@oms/database/prisma';

import { InvalidWorkerMessageError, parseOrderEventPayload } from './consumer-payload';

const CONSUMER_NAME = 'payment-worker';
const SIMULATED_FAILURE_REASON = 'SIMULATED_DECLINE';
const RESERVATION_EXPIRED_REASON = 'RESERVATION_EXPIRED';

class InvalidPaymentStateError extends Error {}

export class PaymentConsumerError extends Error {
  public constructor() {
    super('Payment consumer failed');
    this.name = 'PaymentConsumerError';
  }
}

export function deterministicPaymentAuthorized(orderId: string): boolean {
  const firstDigestByte = createHash('sha256').update(orderId, 'utf8').digest()[0] ?? 0;

  // Stable 80/20 authorization/failure split for the portfolio simulator.
  return firstDigestByte % 5 !== 0;
}

export class PaymentEventConsumer {
  public constructor(private readonly client: PrismaClient) {}

  public async handle(event: EventEnvelope): Promise<MessageDisposition> {
    if (event.type !== 'order.created') {
      return 'dead-letter';
    }

    let payload: ReturnType<typeof parseOrderEventPayload>;

    try {
      payload = parseOrderEventPayload(event.payload);
    } catch (error: unknown) {
      if (error instanceof InvalidWorkerMessageError) {
        return 'dead-letter';
      }

      throw new PaymentConsumerError();
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
            include: {
              payment: true,
              reservation: { include: { lines: true } },
            },
            where: { id: payload.orderId },
          });

          if (order === null || (payload.userId !== undefined && order.userId !== payload.userId)) {
            throw new InvalidPaymentStateError();
          }

          if (order.status !== 'PENDING_PAYMENT') {
            return;
          }

          if (
            order.reservation === null ||
            order.reservation.status !== 'ACTIVE' ||
            (order.payment !== null && order.payment.status !== 'PENDING')
          ) {
            throw new InvalidPaymentStateError();
          }

          const now = new Date();
          const reservationExpired = order.reservation.expiresAt <= now;
          const authorized = !reservationExpired && deterministicPaymentAuthorized(order.id);
          const failureReason = reservationExpired
            ? RESERVATION_EXPIRED_REASON
            : SIMULATED_FAILURE_REASON;
          const targetOrderStatus = authorized
            ? ('CONFIRMED' as const)
            : ('PAYMENT_FAILED' as const);
          const targetPaymentStatus = authorized ? ('AUTHORIZED' as const) : ('FAILED' as const);
          const orderUpdate = await transaction.orderRecord.updateMany({
            data: {
              paymentStatus: targetPaymentStatus,
              status: targetOrderStatus,
              version: { increment: 1 },
            },
            where: { id: order.id, status: 'PENDING_PAYMENT' },
          });

          if (orderUpdate.count !== 1) {
            throw new PaymentConsumerError();
          }

          const payment = await transaction.paymentRecord.upsert({
            create: {
              amount: order.total,
              authorizedAt: authorized ? now : null,
              currency: order.currency,
              failureReason: authorized ? null : failureReason,
              id: randomUUID(),
              orderId: order.id,
              provider: 'SIMULATED',
              providerReference: `sim_${order.id}`,
              status: targetPaymentStatus,
            },
            update: {
              authorizedAt: authorized ? now : null,
              failureReason: authorized ? null : failureReason,
              providerReference: `sim_${order.id}`,
              status: targetPaymentStatus,
            },
            where: { orderId: order.id },
          });

          if (!authorized) {
            for (const line of order.reservation.lines) {
              const inventoryUpdate = await transaction.inventoryItemRecord.updateMany({
                data: {
                  available: { increment: line.quantity },
                  reserved: { decrement: line.quantity },
                },
                where: {
                  reserved: { gte: line.quantity },
                  skuId: line.skuId,
                  warehouseId: order.reservation.warehouseId,
                },
              });

              if (inventoryUpdate.count !== 1) {
                throw new InvalidPaymentStateError();
              }

              await transaction.inventoryMovementRecord.create({
                data: {
                  id: randomUUID(),
                  quantity: line.quantity,
                  reference: order.id,
                  skuId: line.skuId,
                  type: 'RELEASE',
                  warehouseId: order.reservation.warehouseId,
                },
              });
            }
          }

          const reservationUpdate = await transaction.inventoryReservationRecord.updateMany({
            data: authorized
              ? { expiresAt: new Date(now.valueOf() + 24 * 60 * 60 * 1_000) }
              : { status: 'RELEASED' },
            where: {
              id: order.reservation.id,
              status: 'ACTIVE',
            },
          });

          if (reservationUpdate.count !== 1) {
            throw new InvalidPaymentStateError();
          }

          await transaction.orderStatusHistoryRecord.create({
            data: {
              fromStatus: 'PENDING_PAYMENT',
              id: randomUUID(),
              orderId: order.id,
              reason: authorized
                ? 'Payment authorized'
                : reservationExpired
                  ? 'Inventory reservation expired before payment'
                  : 'Simulated payment declined',
              toStatus: targetOrderStatus,
            },
          });
          await transaction.outboxEventRecord.create({
            data: {
              aggregateId: payment.id,
              aggregateType: 'payment',
              eventType: authorized ? 'payment.authorized' : 'payment.failed',
              id: randomUUID(),
              payload: {
                orderId: order.id,
                paymentId: payment.id,
                userId: order.userId,
              },
            },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 10_000,
        },
      );

      return 'ack';
    } catch (error: unknown) {
      if (error instanceof InvalidPaymentStateError) {
        return 'dead-letter';
      }

      throw new PaymentConsumerError();
    }
  }
}
