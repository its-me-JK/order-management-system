import { createHash } from 'node:crypto';

import { BadRequestException, Injectable } from '@nestjs/common';

import {
  OrderRepository,
  type CreateOrderCommand,
  type OrderActor,
  type OrderView,
  type PaymentView,
  type ShippingAddress,
} from './order.repository';

export interface CreateOrderInput {
  readonly actor: OrderActor;
  readonly idempotencyKey: string;
  readonly items: readonly Readonly<{ quantity: number; skuId: string }>[];
  readonly shippingAddress: ShippingAddress;
}

function fingerprint(input: Omit<CreateOrderInput, 'idempotencyKey'>): string {
  const canonicalItems = [...input.items]
    .sort((left, right): number => left.skuId.localeCompare(right.skuId))
    .map((item) => `${item.skuId}:${String(item.quantity)}`)
    .join('|');
  const address = [
    input.shippingAddress.line1,
    input.shippingAddress.city,
    input.shippingAddress.state,
    input.shippingAddress.postalCode,
    input.shippingAddress.country,
  ].join('|');

  return createHash('sha256')
    .update(`${input.actor.id}|${canonicalItems}|${address}`)
    .digest('hex');
}

@Injectable()
export class OrderService {
  public constructor(private readonly repository: OrderRepository) {}

  public create(input: CreateOrderInput): Promise<OrderView> {
    const quantities = new Map<string, number>();

    for (const item of input.items) {
      if (quantities.has(item.skuId)) {
        throw new BadRequestException('Duplicate SKU lines are not allowed');
      }

      quantities.set(item.skuId, item.quantity);
    }

    const normalized = {
      ...input,
      items: [...quantities.entries()].map(([skuId, quantity]) => ({ quantity, skuId })),
    };
    const command: CreateOrderCommand = {
      ...normalized,
      fingerprint: fingerprint(normalized),
    };

    return this.repository.create(command);
  }

  public list(actor: OrderActor): Promise<readonly OrderView[]> {
    return this.repository.list(actor);
  }

  public find(actor: OrderActor, orderId: string): Promise<OrderView> {
    return this.repository.find(actor, orderId);
  }

  public cancel(actor: OrderActor, orderId: string): Promise<OrderView> {
    return this.repository.cancel(actor, orderId);
  }

  public ship(orderId: string): Promise<OrderView> {
    return this.repository.ship(orderId);
  }

  public deliver(orderId: string): Promise<OrderView> {
    return this.repository.deliver(orderId);
  }

  public payment(actor: OrderActor, orderId: string): Promise<PaymentView> {
    return this.repository.payment(actor, orderId);
  }

  public refund(paymentId: string): Promise<PaymentView> {
    return this.repository.refund(paymentId);
  }
}
