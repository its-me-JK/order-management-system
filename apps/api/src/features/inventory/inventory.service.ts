import { Injectable } from '@nestjs/common';

import { InventoryItemNotFoundError } from './inventory.errors';
import {
  InventoryRepository,
  type InventoryAdjustment,
  type InventoryView,
} from './inventory.repository';

@Injectable()
export class InventoryService {
  public constructor(private readonly repository: InventoryRepository) {}

  public list(): Promise<readonly InventoryView[]> {
    return this.repository.list();
  }

  public async findBySku(skuId: string): Promise<readonly InventoryView[]> {
    const inventory = await this.repository.findBySku(skuId);

    if (inventory.length === 0) {
      throw new InventoryItemNotFoundError();
    }

    return inventory;
  }

  public adjust(input: InventoryAdjustment): Promise<InventoryView> {
    return this.repository.adjust(input);
  }
}
