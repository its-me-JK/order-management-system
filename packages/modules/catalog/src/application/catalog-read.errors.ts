export class CatalogReadUnavailableError extends Error {
  public constructor(cause?: unknown) {
    super('Catalog reads are temporarily unavailable', { cause });
    this.name = 'CatalogReadUnavailableError';
  }
}

/**
 * Safe boundary error for unexpected persistence or record-mapping failures.
 *
 * Concrete database errors remain available as `cause` for internal
 * diagnostics, while their vendor-specific details never become part of the
 * application contract.
 */
export class CatalogReadPersistenceError extends Error {
  public constructor(cause?: unknown) {
    super('Catalog read failed', { cause });
    this.name = 'CatalogReadPersistenceError';
  }
}
