declare const catalogPageSizeBrand: unique symbol;

/** A repository-safe number of public SKUs to return. */
export type CatalogPageSize = number & {
  readonly [catalogPageSizeBrand]: true;
};

export const DEFAULT_CATALOG_PAGE_SIZE = 20 as CatalogPageSize;
export const MAX_CATALOG_PAGE_SIZE = 100;

export class InvalidCatalogPageSizeError extends Error {
  public constructor() {
    super(`Catalog page size must be an integer between 1 and ${String(MAX_CATALOG_PAGE_SIZE)}`);
    this.name = 'InvalidCatalogPageSizeError';
  }
}

/** Applies the public Catalog default and rejects unbounded repository reads. */
export function parseCatalogPageSize(value: unknown): CatalogPageSize {
  if (value === undefined) {
    return DEFAULT_CATALOG_PAGE_SIZE;
  }

  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_CATALOG_PAGE_SIZE
  ) {
    throw new InvalidCatalogPageSizeError();
  }

  return value as CatalogPageSize;
}
