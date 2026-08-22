export const OPERATIONAL_HEALTH_CONTENT_TYPE = 'application/json; charset=utf-8';
export const OPERATIONAL_HEALTH_CACHE_CONTROL = 'no-cache, no-store, must-revalidate';

export type OperationalHealthEndpoint = 'live' | 'ready';

export interface OperationalHealthFailureResponse {
  readonly status: 'error' | 'shutting_down';
  readonly info: Readonly<Record<string, unknown>>;
  readonly error: Readonly<Record<string, unknown>>;
  readonly details: Readonly<Record<string, unknown>>;
}

const EMPTY_RECORD = Object.freeze({});
const DATABASE_UP = Object.freeze({ status: 'up' as const });
const DATABASE_DOWN = Object.freeze({ status: 'down' as const });
const DATABASE_AVAILABLE = Object.freeze({ database: DATABASE_UP });
const DATABASE_FAILURE = Object.freeze({ database: DATABASE_DOWN });
const UNAVAILABLE_HEALTH_RESPONSE: OperationalHealthFailureResponse = Object.freeze({
  status: 'error',
  info: EMPTY_RECORD,
  error: DATABASE_FAILURE,
  details: DATABASE_FAILURE,
});
const LIVE_SHUTTING_DOWN_RESPONSE: OperationalHealthFailureResponse = Object.freeze({
  status: 'shutting_down',
  info: EMPTY_RECORD,
  error: EMPTY_RECORD,
  details: EMPTY_RECORD,
});
const READY_SHUTTING_DOWN_AVAILABLE_RESPONSE: OperationalHealthFailureResponse = Object.freeze({
  status: 'shutting_down',
  info: DATABASE_AVAILABLE,
  error: EMPTY_RECORD,
  details: DATABASE_AVAILABLE,
});
const READY_SHUTTING_DOWN_UNAVAILABLE_RESPONSE: OperationalHealthFailureResponse = Object.freeze({
  status: 'shutting_down',
  info: EMPTY_RECORD,
  error: DATABASE_FAILURE,
  details: DATABASE_FAILURE,
});
const MISSING_VALUE = Symbol('missing-value');

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;

  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(record: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const keys = Reflect.ownKeys(record);

  return (
    keys.length === expectedKeys.length &&
    keys.every((key): boolean => typeof key === 'string' && expectedKeys.includes(key))
  );
}

function ownDataValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);

  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : MISSING_VALUE;
}

function isEmptyRecord(value: unknown): boolean {
  return isPlainRecord(value) && hasExactKeys(value, []);
}

function isDatabaseStatusRecord(value: unknown, status: 'down' | 'up'): boolean {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['database'])) {
    return false;
  }

  const database = ownDataValue(value, 'database');

  return (
    isPlainRecord(database) &&
    hasExactKeys(database, ['status']) &&
    ownDataValue(database, 'status') === status
  );
}

function canonicalizeReadinessFailure(
  candidate: Record<string, unknown>,
): OperationalHealthFailureResponse | undefined {
  const status = ownDataValue(candidate, 'status');
  const info = ownDataValue(candidate, 'info');
  const error = ownDataValue(candidate, 'error');
  const details = ownDataValue(candidate, 'details');

  if (
    status === 'error' &&
    isEmptyRecord(info) &&
    isDatabaseStatusRecord(error, 'down') &&
    isDatabaseStatusRecord(details, 'down')
  ) {
    return UNAVAILABLE_HEALTH_RESPONSE;
  }

  if (status !== 'shutting_down') {
    return undefined;
  }

  if (
    isDatabaseStatusRecord(info, 'up') &&
    isEmptyRecord(error) &&
    isDatabaseStatusRecord(details, 'up')
  ) {
    return READY_SHUTTING_DOWN_AVAILABLE_RESPONSE;
  }

  return isEmptyRecord(info) &&
    isDatabaseStatusRecord(error, 'down') &&
    isDatabaseStatusRecord(details, 'down')
    ? READY_SHUTTING_DOWN_UNAVAILABLE_RESPONSE
    : undefined;
}

export function canonicalizeOperationalHealthFailureResponse(
  candidate: unknown,
  endpoint: OperationalHealthEndpoint,
): OperationalHealthFailureResponse | undefined {
  try {
    if (
      !isPlainRecord(candidate) ||
      !hasExactKeys(candidate, ['status', 'info', 'error', 'details'])
    ) {
      return undefined;
    }

    if (endpoint === 'ready') {
      return canonicalizeReadinessFailure(candidate);
    }

    return ownDataValue(candidate, 'status') === 'shutting_down' &&
      isEmptyRecord(ownDataValue(candidate, 'info')) &&
      isEmptyRecord(ownDataValue(candidate, 'error')) &&
      isEmptyRecord(ownDataValue(candidate, 'details'))
      ? LIVE_SHUTTING_DOWN_RESPONSE
      : undefined;
  } catch {
    return undefined;
  }
}
