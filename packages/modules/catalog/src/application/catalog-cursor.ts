import { parseCatalogSkuId, type CatalogSkuId } from './catalog-sku-id';

const CATALOG_CURSOR_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;

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

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  if (month === 4 || month === 6 || month === 9 || month === 11) {
    return 30;
  }

  return 31;
}

/**
 * Validates and brands a timestamp used inside decoded catalog cursors.
 *
 * This intentionally does not pass through `Date`: JavaScript dates discard
 * the final three microsecond digits and can make a seek cursor ambiguous.
 */
export function parseCatalogCursorTimestamp(value: string): CatalogCursorTimestamp {
  if (typeof value !== 'string' || !CATALOG_CURSOR_TIMESTAMP_PATTERN.test(value)) {
    throw new InvalidCatalogCursorTimestampError();
  }

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const hour = Number(value.slice(11, 13));
  const minute = Number(value.slice(14, 16));
  const second = Number(value.slice(17, 19));

  const hasValidCalendarDate =
    year >= 1000 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
  const hasValidClockTime = hour <= 23 && minute <= 59 && second <= 59;

  if (!hasValidCalendarDate || !hasValidClockTime) {
    throw new InvalidCatalogCursorTimestampError();
  }

  return value as CatalogCursorTimestamp;
}

/** Validates both components of an already-decoded Catalog seek cursor. */
export function parseCatalogSkuPageCursor(value: CatalogSkuPageCursorInput): CatalogSkuPageCursor {
  return {
    createdAt: parseCatalogCursorTimestamp(value.createdAt),
    id: parseCatalogSkuId(value.id),
  };
}
