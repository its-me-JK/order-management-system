const IDENTITY_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u;

declare const identityInstantBrand: unique symbol;
declare const identityAggregateVersionBrand: unique symbol;

/** A valid MySQL-range UTC instant retaining all DATETIME(6) digits. */
export type IdentityInstant = string & {
  readonly [identityInstantBrand]: true;
};

/** A positive aggregate version representable by an unsigned 32-bit column. */
export type IdentityAggregateVersion = number & {
  readonly [identityAggregateVersionBrand]: true;
};

export const MAX_IDENTITY_AGGREGATE_VERSION = 4_294_967_295;

export class InvalidIdentityInstantError extends Error {
  public constructor() {
    super('Expected a valid UTC Identity instant with exactly six fractional digits');
    this.name = 'InvalidIdentityInstantError';
  }
}

export class InvalidIdentityAggregateVersionError extends Error {
  public constructor() {
    super('Expected a supported positive Identity aggregate version');
    this.name = 'InvalidIdentityAggregateVersionError';
  }
}

export class IdentityAggregateVersionExhaustedError extends Error {
  public constructor() {
    super('The Identity aggregate version capacity is exhausted');
    this.name = 'IdentityAggregateVersionExhaustedError';
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
export function parseIdentityInstant(value: unknown): IdentityInstant {
  if (typeof value !== 'string' || !IDENTITY_INSTANT_PATTERN.test(value)) {
    throw new InvalidIdentityInstantError();
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
    throw new InvalidIdentityInstantError();
  }

  return value as IdentityInstant;
}

/** Fixed-width canonical instants compare in chronological order as strings. */
export function compareIdentityInstants(left: IdentityInstant, right: IdentityInstant): -1 | 0 | 1 {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

export function parseIdentityAggregateVersion(value: unknown): IdentityAggregateVersion {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_IDENTITY_AGGREGATE_VERSION
  ) {
    throw new InvalidIdentityAggregateVersionError();
  }

  return value as IdentityAggregateVersion;
}

export function nextIdentityAggregateVersion(
  current: IdentityAggregateVersion,
): IdentityAggregateVersion {
  const validatedCurrent = parseIdentityAggregateVersion(current);

  if (validatedCurrent === MAX_IDENTITY_AGGREGATE_VERSION) {
    throw new IdentityAggregateVersionExhaustedError();
  }

  return (validatedCurrent + 1) as IdentityAggregateVersion;
}
