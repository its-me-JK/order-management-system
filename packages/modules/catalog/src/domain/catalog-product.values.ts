const CATALOG_PRODUCT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

declare const catalogProductIdBrand: unique symbol;

export type CatalogProductId = string & {
  readonly [catalogProductIdBrand]: true;
};

export const CATALOG_PRODUCT_STATUSES = Object.freeze([
  'DRAFT',
  'ACTIVE',
  'SUSPENDED',
  'ARCHIVED',
] as const);

export type CatalogProductStatus = (typeof CATALOG_PRODUCT_STATUSES)[number];

export class InvalidCatalogProductIdError extends Error {
  public constructor() {
    super('Expected a canonical lowercase UUIDv7 Catalog Product identifier');
    this.name = 'InvalidCatalogProductIdError';
  }
}

export class InvalidCatalogProductStatusError extends Error {
  public constructor() {
    super('Expected a supported Catalog Product status');
    this.name = 'InvalidCatalogProductStatusError';
  }
}

export function parseCatalogProductId(value: unknown): CatalogProductId {
  if (typeof value !== 'string' || !CATALOG_PRODUCT_ID_PATTERN.test(value)) {
    throw new InvalidCatalogProductIdError();
  }

  return value as CatalogProductId;
}

export function parseCatalogProductStatus(value: unknown): CatalogProductStatus {
  if (typeof value !== 'string' || !CATALOG_PRODUCT_STATUSES.some((status) => status === value)) {
    throw new InvalidCatalogProductStatusError();
  }

  return value as CatalogProductStatus;
}
