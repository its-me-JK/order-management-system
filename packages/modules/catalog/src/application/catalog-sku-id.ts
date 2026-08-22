const CATALOG_SKU_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

declare const catalogSkuIdBrand: unique symbol;

/** A canonical, lowercase UUIDv7 identifying a Catalog SKU. */
export type CatalogSkuId = string & {
  readonly [catalogSkuIdBrand]: true;
};

export class InvalidCatalogSkuIdError extends Error {
  public constructor() {
    super('Expected a canonical lowercase UUIDv7 Catalog SKU identifier');
    this.name = 'InvalidCatalogSkuIdError';
  }
}

/** Validates an untrusted application input before it reaches persistence. */
export function parseCatalogSkuId(value: unknown): CatalogSkuId {
  if (typeof value !== 'string' || !CATALOG_SKU_ID_PATTERN.test(value)) {
    throw new InvalidCatalogSkuIdError();
  }

  return value as CatalogSkuId;
}
