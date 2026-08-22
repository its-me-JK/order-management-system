export class InvalidCatalogSkuStateError extends Error {
  public constructor() {
    super('Expected a valid Catalog SKU snapshot');
    this.name = 'InvalidCatalogSkuStateError';
  }
}

export class CatalogSkuVersionMismatchError extends Error {
  public constructor() {
    super('The Catalog SKU version does not match the expected version');
    this.name = 'CatalogSkuVersionMismatchError';
  }
}

export class CatalogSkuLifecycleConflictError extends Error {
  public constructor() {
    super('The Catalog SKU lifecycle operation is not allowed');
    this.name = 'CatalogSkuLifecycleConflictError';
  }
}

export class CatalogSkuTimestampRegressionError extends Error {
  public constructor() {
    super('The Catalog SKU mutation time precedes its current update time');
    this.name = 'CatalogSkuTimestampRegressionError';
  }
}
