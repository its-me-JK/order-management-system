export type OrderActor = Readonly<{ id: string; role: 'ADMIN' | 'CUSTOMER' }>;

export interface ShippingAddress {
  readonly city: string;
  readonly country: string;
  readonly line1: string;
  readonly postalCode: string;
  readonly state: string;
}

export interface CreateOrderItem {
  readonly quantity: number;
  readonly skuId: string;
}

export interface CreateOrderCommand {
  readonly actor: OrderActor;
  readonly fingerprint: string;
  readonly idempotencyKey: string;
  readonly items: readonly CreateOrderItem[];
  readonly shippingAddress: ShippingAddress;
}

export interface OrderItemView {
  readonly id: string;
  readonly lineTotal: string;
  readonly quantity: number;
  readonly skuCode: string;
  readonly skuId: string;
  readonly skuName: string;
  readonly unitPrice: string;
}

export interface OrderTimelineEntry {
  readonly createdAt: string;
  readonly fromStatus: string | null;
  readonly id: string;
  readonly reason: string | null;
  readonly toStatus: string;
}

export interface PaymentView {
  readonly amount: string;
  readonly authorizedAt: string | null;
  readonly currency: string;
  readonly id: string;
  readonly provider: string;
  readonly providerReference: string | null;
  readonly refundedAt: string | null;
  readonly status: string;
}

export interface OrderView {
  readonly createdAt: string;
  readonly currency: string;
  readonly customerEmail: string;
  readonly customerName: string;
  readonly id: string;
  readonly items: readonly OrderItemView[];
  readonly orderNumber: string;
  readonly payment: PaymentView | null;
  readonly paymentStatus: string;
  readonly shippingAddress: ShippingAddress;
  readonly status: string;
  readonly timeline: readonly OrderTimelineEntry[];
  readonly total: string;
  readonly updatedAt: string;
}

export abstract class OrderRepository {
  public abstract create(command: CreateOrderCommand): Promise<OrderView>;
  public abstract list(actor: OrderActor): Promise<readonly OrderView[]>;
  public abstract find(actor: OrderActor, orderId: string): Promise<OrderView>;
  public abstract cancel(actor: OrderActor, orderId: string): Promise<OrderView>;
  public abstract ship(orderId: string): Promise<OrderView>;
  public abstract deliver(orderId: string): Promise<OrderView>;
  public abstract payment(actor: OrderActor, orderId: string): Promise<PaymentView>;
  public abstract refund(paymentId: string): Promise<PaymentView>;
}
