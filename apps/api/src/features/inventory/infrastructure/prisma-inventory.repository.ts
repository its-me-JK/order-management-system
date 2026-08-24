import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@oms/database/prisma';

import { DATABASE_CLIENT } from '../../../platform/database/database.tokens';
import { InsufficientInventoryError, InventoryItemNotFoundError } from '../inventory.errors';
import {
  InventoryRepository,
  type InventoryAdjustment,
  type InventoryView,
} from '../inventory.repository';

const toView = (item: {
  available: number;
  onHand: number;
  reserved: number;
  version: number;
  sku: { code: string; id: string; name: string };
  warehouse: { code: string; id: string; name: string };
}): InventoryView => ({
  available: item.available,
  onHand: item.onHand,
  reserved: item.reserved,
  skuCode: item.sku.code,
  skuId: item.sku.id,
  skuName: item.sku.name,
  version: item.version,
  warehouseCode: item.warehouse.code,
  warehouseId: item.warehouse.id,
  warehouseName: item.warehouse.name,
});

const inventoryInclude = {
  sku: { select: { code: true, id: true, name: true } },
  warehouse: { select: { code: true, id: true, name: true } },
} as const;

@Injectable()
export class PrismaInventoryRepository extends InventoryRepository {
  public constructor(
    @Inject(DATABASE_CLIENT)
    private readonly client: PrismaClient,
  ) {
    super();
  }

  public async list(): Promise<readonly InventoryView[]> {
    const items = await this.client.inventoryItemRecord.findMany({
      include: inventoryInclude,
      orderBy: [{ sku: { code: 'asc' } }, { warehouse: { code: 'asc' } }],
    });

    return items.map(toView);
  }

  public async findBySku(skuId: string): Promise<readonly InventoryView[]> {
    const items = await this.client.inventoryItemRecord.findMany({
      include: inventoryInclude,
      orderBy: { warehouse: { code: 'asc' } },
      where: { skuId },
    });

    return items.map(toView);
  }

  public adjust(input: InventoryAdjustment): Promise<InventoryView> {
    return this.client.$transaction(async (transaction): Promise<InventoryView> => {
      const item = await transaction.inventoryItemRecord.findUnique({
        include: inventoryInclude,
        where: {
          warehouseId_skuId: {
            skuId: input.skuId,
            warehouseId: input.warehouseId,
          },
        },
      });

      if (item === null) {
        throw new InventoryItemNotFoundError();
      }

      const magnitude = Math.abs(input.delta);
      const updated =
        input.delta >= 0
          ? await transaction.inventoryItemRecord.update({
              data: {
                available: { increment: magnitude },
                onHand: { increment: magnitude },
                version: { increment: 1 },
              },
              include: inventoryInclude,
              where: { id: item.id },
            })
          : await this.decreaseAvailable(transaction, item.id, magnitude);

      await transaction.inventoryMovementRecord.create({
        data: {
          id: randomUUID(),
          quantity: input.delta,
          reference: input.reason,
          skuId: item.sku.id,
          type: 'ADJUSTMENT',
          warehouseId: item.warehouse.id,
        },
      });

      return toView(updated);
    });
  }

  private async decreaseAvailable(
    transaction: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0],
    id: string,
    magnitude: number,
  ) {
    const result = await transaction.inventoryItemRecord.updateMany({
      data: {
        available: { decrement: magnitude },
        onHand: { decrement: magnitude },
        version: { increment: 1 },
      },
      where: { available: { gte: magnitude }, id },
    });

    if (result.count !== 1) {
      throw new InsufficientInventoryError();
    }

    const updated = await transaction.inventoryItemRecord.findUnique({
      include: inventoryInclude,
      where: { id },
    });

    if (updated === null) {
      throw new InventoryItemNotFoundError();
    }

    return updated;
  }
}
