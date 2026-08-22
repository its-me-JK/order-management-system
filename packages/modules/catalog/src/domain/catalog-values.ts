const CATALOG_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;

declare const catalogInstantBrand: unique symbol;
declare const catalogAggregateVersionBrand: unique symbol;

/** A valid MySQL-range UTC instant retaining all DATETIME(6) digits. */
export type CatalogInstant = string & {
  readonly [catalogInstantBrand]: true;
};

/** A positive aggregate version representable by the current unsigned column. */
export type CatalogAggregateVersion = number & {
  readonly [catalogAggregateVersionBrand]: true;
};

export const MAX_CATALOG_AGGREGATE_VERSION = 4_294_967_295;

export const CATALOG_LIFECYCLE_REASON_CODES = Object.freeze([
  'CONTENT_ERROR',
  'COMPLIANCE_HOLD',
  'SAFETY_RECALL',
  'DISCONTINUED',
  'DUPLICATE_RECORD',
  'MERCHANDISING_DECISION',
] as const);

export type CatalogLifecycleReasonCode = (typeof CATALOG_LIFECYCLE_REASON_CODES)[number];

export class InvalidCatalogInstantError extends Error {
  public constructor() {
    super('Expected a valid UTC Catalog instant with exactly six fractional digits');
    this.name = 'InvalidCatalogInstantError';
  }
}

export class InvalidCatalogAggregateVersionError extends Error {
  public constructor() {
    super('Expected a supported positive Catalog aggregate version');
    this.name = 'InvalidCatalogAggregateVersionError';
  }
}

export class CatalogAggregateVersionExhaustedError extends Error {
  public constructor() {
    super('The Catalog aggregate version capacity is exhausted');
    this.name = 'CatalogAggregateVersionExhaustedError';
  }
}

export class InvalidCatalogLifecycleReasonCodeError extends Error {
  public constructor() {
    super('Expected a supported Catalog lifecycle reason code');
    this.name = 'InvalidCatalogLifecycleReasonCodeError';
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

/** Validates without converting through JavaScript Date and losing microseconds. */
export function parseCatalogInstant(value: unknown): CatalogInstant {
  if (typeof value !== 'string' || !CATALOG_INSTANT_PATTERN.test(value)) {
    throw new InvalidCatalogInstantError();
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
    throw new InvalidCatalogInstantError();
  }

  return value as CatalogInstant;
}

/** Fixed-width canonical instants compare in chronological order as strings. */
export function compareCatalogInstants(left: CatalogInstant, right: CatalogInstant): -1 | 0 | 1 {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

export function parseCatalogAggregateVersion(value: unknown): CatalogAggregateVersion {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_CATALOG_AGGREGATE_VERSION
  ) {
    throw new InvalidCatalogAggregateVersionError();
  }

  return value as CatalogAggregateVersion;
}

export function nextCatalogAggregateVersion(
  current: CatalogAggregateVersion,
): CatalogAggregateVersion {
  const validatedCurrent = parseCatalogAggregateVersion(current);

  if (validatedCurrent === MAX_CATALOG_AGGREGATE_VERSION) {
    throw new CatalogAggregateVersionExhaustedError();
  }

  return (validatedCurrent + 1) as CatalogAggregateVersion;
}

export function parseCatalogLifecycleReasonCode(value: unknown): CatalogLifecycleReasonCode {
  if (
    typeof value !== 'string' ||
    !CATALOG_LIFECYCLE_REASON_CODES.some((reasonCode) => reasonCode === value)
  ) {
    throw new InvalidCatalogLifecycleReasonCodeError();
  }

  return value as CatalogLifecycleReasonCode;
}
