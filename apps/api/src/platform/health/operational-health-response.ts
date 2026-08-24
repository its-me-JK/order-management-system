export const OPERATIONAL_HEALTH_CONTENT_TYPE = 'application/json; charset=utf-8';
export const OPERATIONAL_HEALTH_CACHE_CONTROL = 'no-cache, no-store, must-revalidate';

export type OperationalHealthEndpoint = 'live' | 'ready';

export interface OperationalHealthFailureResponse {
  readonly status: 'error' | 'shutting_down';
  readonly info: Readonly<Record<string, unknown>>;
  readonly error: Readonly<Record<string, unknown>>;
  readonly details: Readonly<Record<string, unknown>>;
}

const COMPONENT_NAMES = ['database', 'redis'] as const;
type ComponentName = (typeof COMPONENT_NAMES)[number];
type ComponentStatus = 'down' | 'up';
type ComponentMap = Readonly<Partial<Record<ComponentName, Readonly<{ status: ComponentStatus }>>>>;

const EMPTY_RECORD = Object.freeze({});
const LIVE_SHUTTING_DOWN_RESPONSE: OperationalHealthFailureResponse = Object.freeze({
  status: 'shutting_down',
  info: EMPTY_RECORD,
  error: EMPTY_RECORD,
  details: EMPTY_RECORD,
});
const MISSING_VALUE = Symbol('missing-value');

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function ownDataValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : MISSING_VALUE;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Reflect.ownKeys(record).every(
    (key): boolean => typeof key === 'string' && allowed.includes(key),
  );
}

function componentMap(value: unknown, requiredStatus?: ComponentStatus): ComponentMap | undefined {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, COMPONENT_NAMES)) {
    return undefined;
  }

  const result: Partial<Record<ComponentName, Readonly<{ status: ComponentStatus }>>> = {};

  for (const name of COMPONENT_NAMES) {
    const component = ownDataValue(value, name);

    if (component === MISSING_VALUE) continue;
    if (!isPlainRecord(component) || Reflect.ownKeys(component).length !== 1) return undefined;

    const status = ownDataValue(component, 'status');

    if (
      (status !== 'up' && status !== 'down') ||
      (requiredStatus !== undefined && status !== requiredStatus)
    ) {
      return undefined;
    }

    result[name] = Object.freeze({ status });
  }

  return Object.freeze(result);
}

function isComplete(details: ComponentMap): boolean {
  return COMPONENT_NAMES.every((name) => details[name] !== undefined);
}

function isConsistent(info: ComponentMap, error: ComponentMap, details: ComponentMap): boolean {
  return COMPONENT_NAMES.every((name): boolean => {
    const status = details[name]?.status;

    return status === 'up'
      ? info[name]?.status === 'up' && error[name] === undefined
      : status === 'down'
        ? error[name]?.status === 'down' && info[name] === undefined
        : false;
  });
}

function canonicalizeReadinessFailure(
  candidate: Record<string, unknown>,
): OperationalHealthFailureResponse | undefined {
  const status = ownDataValue(candidate, 'status');

  if (status !== 'error' && status !== 'shutting_down') return undefined;

  const info = componentMap(ownDataValue(candidate, 'info'), 'up');
  const error = componentMap(ownDataValue(candidate, 'error'), 'down');
  const details = componentMap(ownDataValue(candidate, 'details'));

  if (
    info === undefined ||
    error === undefined ||
    details === undefined ||
    !isComplete(details) ||
    !isConsistent(info, error, details) ||
    (status === 'error' && Object.keys(error).length === 0)
  ) {
    return undefined;
  }

  return Object.freeze({ status, info, error, details });
}

function isEmptyComponentMap(value: unknown): boolean {
  const parsed = componentMap(value);
  return parsed !== undefined && Object.keys(parsed).length === 0;
}

export function canonicalizeOperationalHealthFailureResponse(
  candidate: unknown,
  endpoint: OperationalHealthEndpoint,
): OperationalHealthFailureResponse | undefined {
  try {
    if (
      !isPlainRecord(candidate) ||
      Reflect.ownKeys(candidate).length !== 4 ||
      !hasOnlyKeys(candidate, ['status', 'info', 'error', 'details'])
    ) {
      return undefined;
    }

    if (endpoint === 'ready') {
      return canonicalizeReadinessFailure(candidate);
    }

    return ownDataValue(candidate, 'status') === 'shutting_down' &&
      isEmptyComponentMap(ownDataValue(candidate, 'info')) &&
      isEmptyComponentMap(ownDataValue(candidate, 'error')) &&
      isEmptyComponentMap(ownDataValue(candidate, 'details'))
      ? LIVE_SHUTTING_DOWN_RESPONSE
      : undefined;
  } catch {
    return undefined;
  }
}
