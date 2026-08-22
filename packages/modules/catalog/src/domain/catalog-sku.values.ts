const CATALOG_SKU_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CATALOG_SKU_CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{2,63}$/u;

declare const catalogSkuIdBrand: unique symbol;
declare const catalogSkuCodeBrand: unique symbol;

/** A canonical, lowercase UUIDv7 identifying a Catalog SKU. */
export type CatalogSkuId = string & {
  readonly [catalogSkuIdBrand]: true;
};

/** An immutable, globally scoped Catalog business identifier. */
export type CatalogSkuCode = string & {
  readonly [catalogSkuCodeBrand]: true;
};

export const CATALOG_SKU_STATUSES = Object.freeze([
  'DRAFT',
  'ACTIVE',
  'SUSPENDED',
  'RETIRED',
] as const);

export type CatalogSkuStatus = (typeof CATALOG_SKU_STATUSES)[number];

export class InvalidCatalogSkuIdError extends Error {
  public constructor() {
    super('Expected a canonical lowercase UUIDv7 Catalog SKU identifier');
    this.name = 'InvalidCatalogSkuIdError';
  }
}

export class InvalidCatalogSkuCodeError extends Error {
  public constructor() {
    super('Expected a valid Catalog SKU code');
    this.name = 'InvalidCatalogSkuCodeError';
  }
}

export class InvalidCatalogSkuStatusError extends Error {
  public constructor() {
    super('Expected a supported Catalog SKU status');
    this.name = 'InvalidCatalogSkuStatusError';
  }
}

export function parseCatalogSkuId(value: unknown): CatalogSkuId {
  if (typeof value !== 'string' || !CATALOG_SKU_ID_PATTERN.test(value)) {
    throw new InvalidCatalogSkuIdError();
  }

  return value as CatalogSkuId;
}

/** Rejects rather than normalizing because case is part of SKU identity. */
export function parseCatalogSkuCode(value: unknown): CatalogSkuCode {
  if (typeof value !== 'string' || !CATALOG_SKU_CODE_PATTERN.test(value)) {
    throw new InvalidCatalogSkuCodeError();
  }

  return value as CatalogSkuCode;
}

export function parseCatalogSkuStatus(value: unknown): CatalogSkuStatus {
  if (typeof value !== 'string' || !CATALOG_SKU_STATUSES.some((status) => status === value)) {
    throw new InvalidCatalogSkuStatusError();
  }

  return value as CatalogSkuStatus;
}
