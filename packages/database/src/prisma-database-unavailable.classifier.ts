import { Prisma } from './generated/prisma/client';

const TOP_LEVEL_DATABASE_UNAVAILABLE_CODES = new Set([
  'P1001',
  'P1002',
  'P1008',
  'P1017',
  'P2024',
  'P2037',
]);

const DRIVER_WRAPPER_CODES = new Set(['P2010', 'P2039']);
const MYSQL_CONNECTION_SQLSTATE_PATTERN = /^08[A-Z0-9]{3}$/u;

// Pinned to the connection, socket, pool, and timeout errors exposed by
// mariadb 3.4.x. ER_POOL_ALREADY_CLOSED (45027),
// ER_ADD_CONNECTION_CLOSED_POOL (45035), and ER_CLOSING_POOL (45037) are
// deliberately excluded: using or closing a locally owned pool incorrectly is
// an application lifecycle defect, not a remote outage.
const TRANSIENT_MARIADB_DRIVER_CODES = new Set([
  45001, 45009, 45012, 45013, 45019, 45026, 45028, 45039, 45042,
]);

type UnknownRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalNumericCode(value: unknown): number | null {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    return null;
  }

  const parsed = Number(value);

  return Number.isSafeInteger(parsed) && String(parsed) === value ? parsed : null;
}

function isUnavailableMySqlDriverCause(value: unknown): boolean {
  if (!isRecord(value) || value['kind'] !== 'mysql') {
    return false;
  }

  const state = value['state'];

  if (typeof state === 'string' && MYSQL_CONNECTION_SQLSTATE_PATTERN.test(state)) {
    return true;
  }

  const code = value['code'];

  if (typeof code === 'number') {
    return Number.isInteger(code) && TRANSIENT_MARIADB_DRIVER_CODES.has(code);
  }

  // The MariaDB adapter normally provides a numeric `code`. Fall back only
  // when that field is absent, and accept `originalCode` solely in canonical
  // unsigned decimal form so coercion cannot broaden the classification.
  if (code !== undefined) {
    return false;
  }

  const originalCode = canonicalNumericCode(value['originalCode']);

  return originalCode !== null && TRANSIENT_MARIADB_DRIVER_CODES.has(originalCode);
}

function hasUnavailableDriverCause(
  error: InstanceType<typeof Prisma.PrismaClientKnownRequestError>,
): boolean {
  if (!DRIVER_WRAPPER_CODES.has(error.code) || !isRecord(error.meta)) {
    return false;
  }

  const driverAdapterError = error.meta['driverAdapterError'];

  return isRecord(driverAdapterError) && isUnavailableMySqlDriverCause(driverAdapterError['cause']);
}

/**
 * Classifies only nominal Prisma database-unavailability failures.
 *
 * Raw and generic driver failures are recognized solely through structured
 * Prisma metadata. Messages are intentionally ignored because they are not a
 * stable or trustworthy machine contract.
 */
export function isPrismaDatabaseUnavailableError(error: unknown): boolean {
  try {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return (
        TOP_LEVEL_DATABASE_UNAVAILABLE_CODES.has(error.code) || hasUnavailableDriverCause(error)
      );
    }

    return (
      error instanceof Prisma.PrismaClientInitializationError &&
      error.errorCode !== undefined &&
      TOP_LEVEL_DATABASE_UNAVAILABLE_CODES.has(error.errorCode)
    );
  } catch {
    return false;
  }
}
