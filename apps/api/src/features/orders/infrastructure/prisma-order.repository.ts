import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@oms/database/prisma';

import { DATABASE_CLIENT } from '../../../platform/database/database.tokens';
import {
  OrderCurrencyMismatchError,
  OrderIdempotencyConflictError,
  OrderInventoryUnavailableError,
  OrderNotFoundError,
  OrderTransitionNotAllowedError,
  PaymentNotFoundError,
} from '../order.errors';
import {
  OrderRepository,
  type CreateOrderCommand,
  type OrderActor,
  type OrderView,
  type PaymentView,
  type ShippingAddress,
} from '../order.repository';

const orderInclude = {
  history: { orderBy: { createdAt: 'asc' as const } },
  items: { orderBy: { skuCode: 'asc' as const } },
  payment: true,
} satisfies Prisma.OrderRecordInclude;

const orderWithReservationInclude = {
  ...orderInclude,
  reservation: { include: { lines: true } },
} satisfies Prisma.OrderRecordInclude;

type OrderWithRelations = Prisma.OrderRecordGetPayload<{ include: typeof orderInclude }>;
type OrderWithReservation = Prisma.OrderRecordGetPayload<{
  include: typeof orderWithReservationInclude;
}>;

function parseShippingAddress(value: Prisma.JsonValue): ShippingAddress {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Persisted shipping address is invalid');
  }

  const address = value as Record<string, Prisma.JsonValue>;
  const line1 = address['line1'];
  const city = address['city'];
  const state = address['state'];
  const postalCode = address['postalCode'];
  const country = address['country'];

  if (
    typeof line1 !== 'string' ||
    typeof city !== 'string' ||
    typeof state !== 'string' ||
    typeof postalCode !== 'string' ||
    typeof country !== 'string'
  ) {
    throw new TypeError('Persisted shipping address is invalid');
  }

  return { city, country, line1, postalCode, state };
}

function toPaymentView(payment: OrderWithRelations['payment']): PaymentView | null {
  if (payment === null) {
    return null;
  }

  return {
    amount: payment.amount.toFixed(2),
    authorizedAt: payment.authorizedAt?.toISOString() ?? null,
    currency: payment.currency,
    id: payment.id,
    provider: payment.provider,
    providerReference: payment.providerReference,
    refundedAt: payment.refundedAt?.toISOString() ?? null,
    status: payment.status,
  };
}

function toOrderView(order: OrderWithRelations): OrderView {
  return {
    createdAt: order.createdAt.toISOString(),
    currency: order.currency,
    customerEmail: order.customerEmail,
    customerName: order.customerName,
    id: order.id,
    items: order.items.map((item) => ({
      id: item.id,
      lineTotal: item.lineTotal.toFixed(2),
      quantity: item.quantity,
      skuCode: item.skuCode,
      skuId: item.skuId,
      skuName: item.skuName,
      unitPrice: item.unitPrice.toFixed(2),
    })),
    orderNumber: order.orderNumber,
    payment: toPaymentView(order.payment),
    paymentStatus: order.paymentStatus,
    shippingAddress: parseShippingAddress(order.shippingAddress),
    status: order.status,
    timeline: order.history.map((entry) => ({
      createdAt: entry.createdAt.toISOString(),
      fromStatus: entry.fromStatus,
      id: entry.id,
      reason: entry.reason,
      toStatus: entry.toStatus,
    })),
    total: order.total.toFixed(2),
    updatedAt: order.updatedAt.toISOString(),
  };
}

function cents(decimal: Prisma.Decimal): number {
  const [whole = '0', fraction = ''] = decimal.toFixed(2).split('.');

  return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
}

function money(valueInCents: number): string {
  return (valueInCents / 100).toFixed(2);
}

function orderNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');

  return `OMS-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function canRead(actor: OrderActor, userId: string): boolean {
  return actor.role === 'ADMIN' || actor.id === userId;
}

function isPrismaCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  );
}

@Injectable()
export class PrismaOrderRepository extends OrderRepository {
  public constructor(
    @Inject(DATABASE_CLIENT)
    private readonly client: PrismaClient,
  ) {
    super();
  }

  public async create(command: CreateOrderCommand): Promise<OrderView> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.createOnce(command);
      } catch (error: unknown) {
        if (isPrismaCode(error, 'P2002')) {
          const existing = await this.client.orderRecord.findUnique({
            include: orderInclude,
            where: {
              userId_idempotencyKey: {
                idempotencyKey: command.idempotencyKey,
                userId: command.actor.id,
              },
            },
          });

          if (existing !== null) {
            if (existing.idempotencyFingerprint !== command.fingerprint) {
              throw new OrderIdempotencyConflictError();
            }

            return toOrderView(existing);
          }
        }

        if (isPrismaCode(error, 'P2034') && attempt < 2) {
          continue;
        }

        throw error;
      }
    }

    throw new OrderInventoryUnavailableError();
  }

  public async list(actor: OrderActor): Promise<readonly OrderView[]> {
    const orders = await this.client.orderRecord.findMany({
      include: orderInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      where: actor.role === 'ADMIN' ? {} : { userId: actor.id },
    });

    return orders.map(toOrderView);
  }

  public async find(actor: OrderActor, orderId: string): Promise<OrderView> {
    const order = await this.client.orderRecord.findUnique({
      include: orderInclude,
      where: { id: orderId },
    });

    if (order === null || !canRead(actor, order.userId)) {
      throw new OrderNotFoundError();
    }

    return toOrderView(order);
  }

  public cancel(actor: OrderActor, orderId: string): Promise<OrderView> {
    return this.client.$transaction(
      async (transaction): Promise<OrderView> => {
        const order = await transaction.orderRecord.findUnique({
          include: orderWithReservationInclude,
          where: { id: orderId },
        });

        if (order === null || !canRead(actor, order.userId)) {
          throw new OrderNotFoundError();
        }

        if (order.status === 'CANCELLED') {
          return toOrderView(order);
        }

        if (!['PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING'].includes(order.status)) {
          throw new OrderTransitionNotAllowedError();
        }

        await this.releaseReservation(transaction, order);

        const nextPaymentStatus = order.paymentStatus === 'AUTHORIZED' ? 'REFUNDED' : 'CANCELLED';
        const now = new Date();

        if (order.payment !== null) {
          await transaction.paymentRecord.update({
            data: {
              status: nextPaymentStatus,
              ...(nextPaymentStatus === 'REFUNDED' ? { refundedAt: now } : {}),
            },
            where: { id: order.payment.id },
          });
        }

        await transaction.orderRecord.update({
          data: {
            paymentStatus: nextPaymentStatus,
            status: 'CANCELLED',
            version: { increment: 1 },
          },
          where: { id: order.id },
        });
        await transaction.orderStatusHistoryRecord.create({
          data: {
            fromStatus: order.status,
            id: randomUUID(),
            orderId: order.id,
            reason: 'Cancelled by user',
            toStatus: 'CANCELLED',
          },
        });
        await this.writeOutbox(transaction, 'order.cancelled', order.id, order.userId);

        if (nextPaymentStatus === 'REFUNDED' && order.payment !== null) {
          await this.writeOutbox(
            transaction,
            'payment.refunded',
            order.id,
            order.userId,
            order.payment.id,
          );
        }

        return this.requireOrder(transaction, order.id);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  public ship(orderId: string): Promise<OrderView> {
    return this.client.$transaction(
      async (transaction): Promise<OrderView> => {
        const order = await transaction.orderRecord.findUnique({
          include: orderWithReservationInclude,
          where: { id: orderId },
        });

        if (order === null) {
          throw new OrderNotFoundError();
        }

        if (order.status === 'SHIPPED') {
          return toOrderView(order);
        }

        if (
          !['CONFIRMED', 'PROCESSING'].includes(order.status) ||
          order.paymentStatus !== 'AUTHORIZED' ||
          order.reservation?.status !== 'ACTIVE'
        ) {
          throw new OrderTransitionNotAllowedError();
        }

        const reservation = order.reservation;

        for (const line of reservation.lines) {
          const updated = await transaction.inventoryItemRecord.updateMany({
            data: {
              onHand: { decrement: line.quantity },
              reserved: { decrement: line.quantity },
              version: { increment: 1 },
            },
            where: {
              reserved: { gte: line.quantity },
              skuId: line.skuId,
              warehouseId: reservation.warehouseId,
            },
          });

          if (updated.count !== 1) {
            throw new OrderInventoryUnavailableError();
          }
        }

        await transaction.inventoryMovementRecord.createMany({
          data: reservation.lines.map((line) => ({
            id: randomUUID(),
            quantity: -line.quantity,
            reference: order.id,
            skuId: line.skuId,
            type: 'COMMIT' as const,
            warehouseId: reservation.warehouseId,
          })),
        });

        await transaction.inventoryReservationRecord.update({
          data: { status: 'COMMITTED' },
          where: { id: reservation.id },
        });
        await this.transition(transaction, order, 'SHIPPED', 'Order handed to carrier');
        await this.writeOutbox(transaction, 'order.shipped', order.id, order.userId);

        return this.requireOrder(transaction, order.id);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  public deliver(orderId: string): Promise<OrderView> {
    return this.client.$transaction(async (transaction): Promise<OrderView> => {
      const order = await transaction.orderRecord.findUnique({
        include: orderInclude,
        where: { id: orderId },
      });

      if (order === null) {
        throw new OrderNotFoundError();
      }

      if (order.status === 'DELIVERED') {
        return toOrderView(order);
      }

      if (order.status !== 'SHIPPED') {
        throw new OrderTransitionNotAllowedError();
      }

      await this.transition(transaction, order, 'DELIVERED', 'Delivery confirmed');
      await this.writeOutbox(transaction, 'order.delivered', order.id, order.userId);

      return this.requireOrder(transaction, order.id);
    });
  }

  public async payment(actor: OrderActor, orderId: string): Promise<PaymentView> {
    const order = await this.client.orderRecord.findUnique({
      include: { payment: true },
      where: { id: orderId },
    });

    if (order === null || !canRead(actor, order.userId) || order.payment === null) {
      throw new PaymentNotFoundError();
    }

    return toPaymentView(order.payment) as PaymentView;
  }

  public refund(paymentId: string): Promise<PaymentView> {
    return this.client.$transaction(async (transaction): Promise<PaymentView> => {
      const payment = await transaction.paymentRecord.findUnique({
        include: { order: true },
        where: { id: paymentId },
      });

      if (payment === null) {
        throw new PaymentNotFoundError();
      }

      if (payment.status === 'REFUNDED') {
        return toPaymentView(payment) as PaymentView;
      }

      if (payment.status !== 'AUTHORIZED') {
        throw new OrderTransitionNotAllowedError();
      }

      const updated = await transaction.paymentRecord.update({
        data: { refundedAt: new Date(), status: 'REFUNDED' },
        where: { id: payment.id },
      });
      await transaction.orderRecord.update({
        data: { paymentStatus: 'REFUNDED', version: { increment: 1 } },
        where: { id: payment.orderId },
      });
      await this.writeOutbox(
        transaction,
        'payment.refunded',
        payment.orderId,
        payment.order.userId,
        payment.id,
      );

      return toPaymentView(updated) as PaymentView;
    });
  }

  private createOnce(command: CreateOrderCommand): Promise<OrderView> {
    return this.client.$transaction(
      async (transaction): Promise<OrderView> => {
        const existing = await transaction.orderRecord.findUnique({
          include: orderInclude,
          where: {
            userId_idempotencyKey: {
              idempotencyKey: command.idempotencyKey,
              userId: command.actor.id,
            },
          },
        });

        if (existing !== null) {
          if (existing.idempotencyFingerprint !== command.fingerprint) {
            throw new OrderIdempotencyConflictError();
          }

          return toOrderView(existing);
        }

        const user = await transaction.userRecord.findUnique({ where: { id: command.actor.id } });

        if (user === null || user.status !== 'ACTIVE') {
          throw new OrderNotFoundError();
        }

        const skuIds = command.items.map((item) => item.skuId);
        const skus = await transaction.skuRecord.findMany({
          include: { product: true },
          where: { id: { in: skuIds }, status: 'ACTIVE' },
        });

        if (skus.length !== skuIds.length || skus.some((sku) => sku.product.status !== 'ACTIVE')) {
          throw new OrderInventoryUnavailableError();
        }

        const orderCurrency = skus[0]?.currency;

        if (
          orderCurrency === undefined ||
          skus.some((sku): boolean => sku.currency !== orderCurrency)
        ) {
          throw new OrderCurrencyMismatchError();
        }

        const inventory = await transaction.inventoryItemRecord.findMany({
          include: { warehouse: true },
          orderBy: { warehouse: { code: 'asc' } },
          where: { skuId: { in: skuIds } },
        });
        const requirements = new Map(command.items.map((item) => [item.skuId, item.quantity]));
        const inventoryByWarehouse = new Map<string, typeof inventory>();

        for (const item of inventory) {
          const warehouseItems = inventoryByWarehouse.get(item.warehouseId) ?? [];
          warehouseItems.push(item);
          inventoryByWarehouse.set(item.warehouseId, warehouseItems);
        }

        const selected = [...inventoryByWarehouse.values()].find((warehouseItems) =>
          skuIds.every((skuId) => {
            const item = warehouseItems.find((candidate) => candidate.skuId === skuId);
            return item !== undefined && item.available >= (requirements.get(skuId) ?? 0);
          }),
        );

        if (selected === undefined || selected[0] === undefined) {
          throw new OrderInventoryUnavailableError();
        }

        const selectedWarehouseId = selected[0].warehouseId;

        for (const item of selected) {
          const quantity = requirements.get(item.skuId);

          if (quantity === undefined) {
            continue;
          }

          const updated = await transaction.inventoryItemRecord.updateMany({
            data: {
              available: { decrement: quantity },
              reserved: { increment: quantity },
              version: { increment: 1 },
            },
            where: { available: { gte: quantity }, id: item.id },
          });

          if (updated.count !== 1) {
            throw new OrderInventoryUnavailableError();
          }
        }

        const skuById = new Map(skus.map((sku) => [sku.id, sku]));
        let totalCents = 0;
        const itemDrafts = command.items.map((item) => {
          const sku = skuById.get(item.skuId);

          if (sku === undefined) {
            throw new OrderInventoryUnavailableError();
          }

          const lineCents = cents(sku.price) * item.quantity;
          totalCents += lineCents;

          return {
            id: randomUUID(),
            lineTotal: money(lineCents),
            quantity: item.quantity,
            skuCode: sku.code,
            skuId: sku.id,
            skuName: sku.name,
            unitPrice: sku.price,
          };
        });
        const id = randomUUID();
        const paymentId = randomUUID();

        await transaction.orderRecord.create({
          data: {
            currency: orderCurrency,
            customerEmail: user.email,
            customerName: user.displayName,
            history: {
              create: {
                id: randomUUID(),
                reason: 'Order accepted and inventory reserved',
                toStatus: 'PENDING_PAYMENT',
              },
            },
            id,
            idempotencyFingerprint: command.fingerprint,
            idempotencyKey: command.idempotencyKey,
            items: { create: itemDrafts },
            orderNumber: orderNumber(),
            payment: {
              create: {
                amount: money(totalCents),
                currency: orderCurrency,
                id: paymentId,
                status: 'PENDING',
              },
            },
            shippingAddress: {
              city: command.shippingAddress.city,
              country: command.shippingAddress.country,
              line1: command.shippingAddress.line1,
              postalCode: command.shippingAddress.postalCode,
              state: command.shippingAddress.state,
            },
            subtotal: money(totalCents),
            total: money(totalCents),
            userId: user.id,
          },
        });
        await transaction.inventoryReservationRecord.create({
          data: {
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
            id: randomUUID(),
            lines: {
              create: command.items.map((item) => ({
                quantity: item.quantity,
                skuId: item.skuId,
              })),
            },
            orderId: id,
            warehouseId: selectedWarehouseId,
          },
        });
        await transaction.inventoryMovementRecord.createMany({
          data: command.items.map((item) => ({
            id: randomUUID(),
            quantity: -item.quantity,
            reference: id,
            skuId: item.skuId,
            type: 'RESERVATION' as const,
            warehouseId: selectedWarehouseId,
          })),
        });
        await this.writeOutbox(transaction, 'order.created', id, user.id, paymentId);

        return this.requireOrder(transaction, id);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 },
    );
  }

  private async releaseReservation(
    transaction: Prisma.TransactionClient,
    order: OrderWithReservation,
  ): Promise<void> {
    const reservation = order.reservation;

    if (reservation === null || reservation.status !== 'ACTIVE') {
      return;
    }

    for (const line of reservation.lines) {
      const updated = await transaction.inventoryItemRecord.updateMany({
        data: {
          available: { increment: line.quantity },
          reserved: { decrement: line.quantity },
          version: { increment: 1 },
        },
        where: {
          reserved: { gte: line.quantity },
          skuId: line.skuId,
          warehouseId: reservation.warehouseId,
        },
      });

      if (updated.count !== 1) {
        throw new OrderInventoryUnavailableError();
      }
    }

    await transaction.inventoryReservationRecord.update({
      data: { status: 'RELEASED' },
      where: { id: reservation.id },
    });
    await transaction.inventoryMovementRecord.createMany({
      data: reservation.lines.map((line) => ({
        id: randomUUID(),
        quantity: line.quantity,
        reference: order.id,
        skuId: line.skuId,
        type: 'RELEASE' as const,
        warehouseId: reservation.warehouseId,
      })),
    });
  }

  private async transition(
    transaction: Prisma.TransactionClient,
    order: OrderWithRelations,
    toStatus: 'DELIVERED' | 'SHIPPED',
    reason: string,
  ): Promise<void> {
    await transaction.orderRecord.update({
      data: { status: toStatus, version: { increment: 1 } },
      where: { id: order.id },
    });
    await transaction.orderStatusHistoryRecord.create({
      data: {
        fromStatus: order.status,
        id: randomUUID(),
        orderId: order.id,
        reason,
        toStatus,
      },
    });
  }

  private async requireOrder(
    transaction: Prisma.TransactionClient,
    orderId: string,
  ): Promise<OrderView> {
    const order = await transaction.orderRecord.findUnique({
      include: orderInclude,
      where: { id: orderId },
    });

    if (order === null) {
      throw new OrderNotFoundError();
    }

    return toOrderView(order);
  }

  private writeOutbox(
    transaction: Prisma.TransactionClient,
    eventType: string,
    orderId: string,
    userId: string,
    paymentId?: string,
  ): Promise<unknown> {
    return transaction.outboxEventRecord.create({
      data: {
        aggregateId: orderId,
        aggregateType: 'order',
        eventType,
        id: randomUUID(),
        payload: {
          orderId,
          userId,
          ...(paymentId === undefined ? {} : { paymentId }),
        },
      },
    });
  }
}
