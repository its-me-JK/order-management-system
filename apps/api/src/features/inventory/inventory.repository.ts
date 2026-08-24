export interface InventoryView {
  readonly available: number;
  readonly onHand: number;
  readonly reserved: number;
  readonly skuCode: string;
  readonly skuId: string;
  readonly skuName: string;
  readonly version: number;
  readonly warehouseCode: string;
  readonly warehouseId: string;
  readonly warehouseName: string;
}

export interface InventoryAdjustment {
  readonly delta: number;
  readonly reason: string;
  readonly skuId: string;
  readonly warehouseId: string;
}

export abstract class InventoryRepository {
  public abstract list(): Promise<readonly InventoryView[]>;
  public abstract findBySku(skuId: string): Promise<readonly InventoryView[]>;
  public abstract adjust(input: InventoryAdjustment): Promise<InventoryView>;
}
