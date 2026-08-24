import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { PrismaClient } from '@oms/database/prisma';

import { hashPassword } from '../../features/auth/password-hasher';
import { DATABASE_CLIENT } from './database.tokens';

const IDS = Object.freeze({
  admin: '00000000-0000-4000-8000-000000000001',
  customer: '00000000-0000-4000-8000-000000000002',
  warehouse: '00000000-0000-4000-8000-000000000010',
  groceryProduct: '00000000-0000-4000-8000-000000000100',
  householdProduct: '00000000-0000-4000-8000-000000000101',
  riceSku: '00000000-0000-4000-8000-000000001000',
  coffeeSku: '00000000-0000-4000-8000-000000001001',
  cleanerSku: '00000000-0000-4000-8000-000000001002',
});

@Injectable()
export class DemoDataSeed implements OnApplicationBootstrap {
  public constructor(
    @Inject(DATABASE_CLIENT)
    private readonly client: PrismaClient,
  ) {}

  public async onApplicationBootstrap(): Promise<void> {
    if (process.env['DEMO_SEED'] !== 'true') {
      return;
    }

    await this.seedUsers();
    await this.seedCatalog();
  }

  private async seedUsers(): Promise<void> {
    const users = [
      {
        displayName: 'OMS Administrator',
        email: 'admin@oms.local',
        id: IDS.admin,
        password: 'Admin123!',
        role: 'ADMIN' as const,
      },
      {
        displayName: 'Demo Customer',
        email: 'customer@oms.local',
        id: IDS.customer,
        password: 'Customer123!',
        role: 'CUSTOMER' as const,
      },
    ];

    for (const user of users) {
      const existing = await this.client.userRecord.findUnique({
        select: { id: true },
        where: { email: user.email },
      });

      if (existing !== null) {
        continue;
      }

      await this.client.userRecord.create({
        data: {
          displayName: user.displayName,
          email: user.email,
          id: user.id,
          passwordHash: await hashPassword(user.password),
          role: user.role,
        },
      });
    }
  }

  private async seedCatalog(): Promise<void> {
    await this.client.productRecord.upsert({
      create: {
        description: 'Everyday pantry staples with fast local fulfilment.',
        id: IDS.groceryProduct,
        name: 'Pantry essentials',
        status: 'ACTIVE',
      },
      update: {
        description: 'Everyday pantry staples with fast local fulfilment.',
        name: 'Pantry essentials',
        status: 'ACTIVE',
      },
      where: { id: IDS.groceryProduct },
    });
    await this.client.productRecord.upsert({
      create: {
        description: 'Reliable home-care essentials for daily use.',
        id: IDS.householdProduct,
        name: 'Home care',
        status: 'ACTIVE',
      },
      update: {
        description: 'Reliable home-care essentials for daily use.',
        name: 'Home care',
        status: 'ACTIVE',
      },
      where: { id: IDS.householdProduct },
    });

    const skus = [
      {
        code: 'RICE-BASMATI-5KG',
        id: IDS.riceSku,
        name: 'Basmati Rice · 5 kg',
        price: '649.00',
        productId: IDS.groceryProduct,
      },
      {
        code: 'COFFEE-DARK-250G',
        id: IDS.coffeeSku,
        name: 'Dark Roast Coffee · 250 g',
        price: '429.00',
        productId: IDS.groceryProduct,
      },
      {
        code: 'CLEANER-CITRUS-1L',
        id: IDS.cleanerSku,
        name: 'Citrus Floor Cleaner · 1 L',
        price: '219.00',
        productId: IDS.householdProduct,
      },
    ];

    for (const sku of skus) {
      await this.client.skuRecord.upsert({
        create: { ...sku, currency: 'INR', status: 'ACTIVE' },
        update: {
          code: sku.code,
          name: sku.name,
          price: sku.price,
          productId: sku.productId,
          status: 'ACTIVE',
        },
        where: { id: sku.id },
      });
    }

    await this.client.warehouseRecord.upsert({
      create: { code: 'BLR-01', id: IDS.warehouse, name: 'Bengaluru Central' },
      update: { name: 'Bengaluru Central' },
      where: { id: IDS.warehouse },
    });

    for (const [index, sku] of skus.entries()) {
      const existing = await this.client.inventoryItemRecord.findUnique({
        where: { warehouseId_skuId: { skuId: sku.id, warehouseId: IDS.warehouse } },
      });

      if (existing === null) {
        const quantity = 50 + index * 25;

        await this.client.inventoryItemRecord.create({
          data: {
            available: quantity,
            id: `00000000-0000-4000-8000-00000000200${String(index)}`,
            onHand: quantity,
            reserved: 0,
            skuId: sku.id,
            warehouseId: IDS.warehouse,
          },
        });
      }
    }
  }
}
