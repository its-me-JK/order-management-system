export class InvalidCatalogProductStateError extends Error {
  public constructor() {
    super('Expected a valid Catalog Product snapshot');
    this.name = 'InvalidCatalogProductStateError';
  }
}

export class CatalogProductVersionMismatchError extends Error {
  public constructor() {
    super('The Catalog Product version does not match the expected version');
    this.name = 'CatalogProductVersionMismatchError';
  }
}

export class CatalogProductLifecycleConflictError extends Error {
  public constructor() {
    super('The Catalog Product lifecycle operation is not allowed');
    this.name = 'CatalogProductLifecycleConflictError';
  }
}

export class CatalogProductTimestampRegressionError extends Error {
  public constructor() {
    super('The Catalog Product mutation time precedes its current update time');
    this.name = 'CatalogProductTimestampRegressionError';
  }
}
