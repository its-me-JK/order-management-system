export class InventoryItemNotFoundError extends Error {
  public constructor() {
    super('Inventory item was not found');
    this.name = 'InventoryItemNotFoundError';
  }
}

export class InsufficientInventoryError extends Error {
  public constructor() {
    super('Inventory is insufficient for this operation');
    this.name = 'InsufficientInventoryError';
  }
}
