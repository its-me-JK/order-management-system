import { parseCatalogSkuId, type CatalogSkuId } from './catalog-sku-id';
import { InvalidCatalogInstantError, parseCatalogInstant } from '../domain/catalog-values';

declare const catalogCursorTimestampBrand: unique symbol;

/** Canonical UTC timestamp retaining MySQL DATETIME(6) precision. */
export type CatalogCursorTimestamp = string & {
  readonly [catalogCursorTimestampBrand]: true;
};

/** The exclusive seek position for descending `(created_at, id)` order. */
export type CatalogSkuPageCursor = Readonly<{
  createdAt: CatalogCursorTimestamp;
  id: CatalogSkuId;
}>;

/** A decoded, but not yet application-validated, Catalog cursor. */
export type CatalogSkuPageCursorInput = Readonly<{
  createdAt: string;
  id: string;
}>;

export class InvalidCatalogCursorTimestampError extends Error {
  public constructor() {
    super('Expected a valid UTC timestamp with exactly six fractional digits');
    this.name = 'InvalidCatalogCursorTimestampError';
  }
}

/**
 * Validates and brands a timestamp used inside decoded catalog cursors.
 *
 * This intentionally does not pass through `Date`: JavaScript dates discard
 * the final three microsecond digits and can make a seek cursor ambiguous.
 */
export function parseCatalogCursorTimestamp(value: string): CatalogCursorTimestamp {
  try {
    return parseCatalogInstant(value) as unknown as CatalogCursorTimestamp;
  } catch (error: unknown) {
    if (error instanceof InvalidCatalogInstantError) {
      throw new InvalidCatalogCursorTimestampError();
    }

    throw error;
  }
}

/** Validates both components of an already-decoded Catalog seek cursor. */
export function parseCatalogSkuPageCursor(value: CatalogSkuPageCursorInput): CatalogSkuPageCursor {
  return {
    createdAt: parseCatalogCursorTimestamp(value.createdAt),
    id: parseCatalogSkuId(value.id),
  };
}
