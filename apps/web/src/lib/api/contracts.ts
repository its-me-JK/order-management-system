import { z } from 'zod';

const identifierSchema = z.string().trim().min(1).max(128);
const timestampSchema = z.string().datetime({ offset: true });
const currencySchema = z.string().regex(/^[A-Z]{3}$/u);
const statusSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,47}$/u);
const moneySchema = z
  .union([z.number().finite().nonnegative(), z.string().regex(/^\d+(?:\.\d{1,4})?$/u)])
  .transform(Number);

export const userSchema = z.object({
  email: z.email(),
  id: identifierSchema,
  name: z.string().trim().min(1).max(120),
  permissions: z.array(z.string().trim().min(1).max(120)).default([]),
  role: z.string().trim().min(1).max(64).optional(),
  roles: z.array(z.string().trim().min(1).max(64)).default([]),
});

export const loginResponseSchema = z.object({
  accessToken: z.string().min(1).max(8_192),
  csrfToken: z.string().min(1).max(512),
  user: userSchema,
});

export const catalogSkuSchema = z.object({
  available: z.union([z.boolean(), z.number().int().nonnegative()]),
  code: z.string().trim().min(1).max(64),
  currency: currencySchema,
  description: z.string().trim().max(500),
  id: identifierSchema,
  name: z.string().trim().min(1).max(160),
  price: moneySchema,
});

export const catalogResponseSchema = z.object({
  data: z.array(catalogSkuSchema),
});

export const shippingAddressSchema = z.object({
  city: z.string().trim().min(1).max(100),
  country: z.string().trim().min(2).max(2),
  line1: z.string().trim().min(1).max(180),
  postalCode: z.string().trim().min(2).max(20),
  state: z.string().trim().min(1).max(100),
});

const orderItemSchema = z.object({
  id: identifierSchema,
  lineTotal: moneySchema,
  quantity: z.number().int().positive(),
  skuCode: z.string().trim().min(1).max(64),
  skuId: identifierSchema,
  skuName: z.string().trim().min(1).max(160),
  unitPrice: moneySchema,
});

const orderTimelineEntrySchema = z.object({
  createdAt: timestampSchema,
  fromStatus: statusSchema.nullable(),
  id: identifierSchema,
  reason: z.string().trim().max(240).nullable(),
  toStatus: statusSchema,
});

const paymentSchema = z
  .object({
    amount: moneySchema.optional(),
    providerReference: z.string().trim().min(1).max(160).nullable().optional(),
    status: statusSchema,
  })
  .passthrough();

export const orderSchema = z.object({
  createdAt: timestampSchema,
  currency: currencySchema,
  id: identifierSchema,
  items: z.array(orderItemSchema).min(1),
  orderNumber: z.string().trim().min(1).max(64),
  payment: paymentSchema.nullish(),
  paymentStatus: statusSchema,
  shippingAddress: shippingAddressSchema,
  status: statusSchema,
  timeline: z.array(orderTimelineEntrySchema),
  total: moneySchema,
  updatedAt: timestampSchema,
});

export const orderResponseSchema = z.object({ data: orderSchema });
export const ordersResponseSchema = z.object({ data: z.array(orderSchema) });

export const notificationSchema = z.object({
  createdAt: timestampSchema,
  id: identifierSchema,
  message: z.string().trim().min(1).max(500),
  readAt: timestampSchema.nullable(),
  title: z.string().trim().min(1).max(160),
  type: z.string().trim().min(1).max(64),
});

export const notificationsResponseSchema = z.object({
  data: z.array(notificationSchema),
});
export const notificationResponseSchema = z.object({ data: notificationSchema });

export const inventoryItemSchema = z.object({
  available: z.number().int().nonnegative(),
  onHand: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative(),
  skuCode: z.string().trim().min(1).max(64),
  skuId: identifierSchema,
  skuName: z.string().trim().min(1).max(160),
  version: z.number().int().positive(),
  warehouseCode: z.string().trim().min(1).max(64),
  warehouseId: identifierSchema,
  warehouseName: z.string().trim().min(1).max(160),
});

export const inventoryResponseSchema = z.object({
  data: z.array(inventoryItemSchema),
});
export const inventoryItemResponseSchema = z.object({ data: inventoryItemSchema });

export const problemDetailsSchema = z
  .object({
    detail: z.string().optional(),
    instance: z.string().optional(),
    status: z.number().int().optional(),
    title: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();

export type User = z.infer<typeof userSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type CatalogSku = z.infer<typeof catalogSkuSchema>;
export type ShippingAddress = z.infer<typeof shippingAddressSchema>;
export type Order = z.infer<typeof orderSchema>;
export type Notification = z.infer<typeof notificationSchema>;
export type InventoryItem = z.infer<typeof inventoryItemSchema>;

export function availableUnits(availability: CatalogSku['available']): number {
  return typeof availability === 'number' ? availability : availability ? 99 : 0;
}
