import { isIP } from 'node:net';
import { types as nodeUtilTypes } from 'node:util';

import {
  RedisRuntimeUnavailableError,
  type RedisConnectionOptions,
  type RedisTlsOptions,
} from './redis.contract';

const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedIsInteger = Number.isInteger;
const capturedIsProxy = nodeUtilTypes.isProxy;
const capturedReflectOwnKeys = Reflect.ownKeys;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once as an immutable runtime primitive.
const capturedBufferByteLength = Buffer.byteLength;
// eslint-disable-next-line @typescript-eslint/unbound-method -- Captured once as an immutable runtime primitive.
const capturedBufferFrom = Buffer.from;

const CONNECTION_OPTION_KEYS = capturedFreeze([
  'commandQueueLimit',
  'commandTimeoutMilliseconds',
  'connectTimeoutMilliseconds',
  'host',
  'password',
  'port',
  'probeTimeoutMilliseconds',
  'shutdownTimeoutMilliseconds',
  'tls',
  'username',
] as const);

type ConnectionOptionName = (typeof CONNECTION_OPTION_KEYS)[number];

function unavailable(): never {
  throw new RedisRuntimeUnavailableError();
}

function isWellFormed(value: string): boolean {
  return capturedBufferFrom(value, 'utf8').toString('utf8') === value;
}

function assertExactOrdinaryRecord(value: unknown, keys: readonly PropertyKey[]): object {
  if (
    typeof value !== 'object' ||
    value === null ||
    capturedIsProxy(value) ||
    capturedGetPrototypeOf(value) !== Object.prototype
  ) {
    unavailable();
  }

  const ownKeys = capturedReflectOwnKeys(value);

  if (
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    unavailable();
  }

  return value;
}

function readDataProperty(record: object, name: PropertyKey): unknown {
  const descriptor = capturedGetOwnPropertyDescriptor(record, name);

  if (descriptor === undefined || !('value' in descriptor)) {
    unavailable();
  }

  return descriptor.value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (!capturedIsInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    unavailable();
  }

  return value as number;
}

function boundedString(value: unknown, minimumBytes: number, maximumBytes: number): string {
  if (
    typeof value !== 'string' ||
    !isWellFormed(value) ||
    capturedBufferByteLength(value, 'utf8') < minimumBytes ||
    capturedBufferByteLength(value, 'utf8') > maximumBytes
  ) {
    unavailable();
  }

  return value;
}

function validRedisHost(value: string): boolean {
  if (isIP(value) !== 0) {
    return true;
  }

  if (value.split('.').every((component) => /^(?:0[xX][0-9A-Fa-f]+|[0-9]+)$/u.test(component))) {
    return false;
  }

  const labels = value.split('.');

  return labels.every(
    (label) =>
      label.length >= 1 &&
      label.length <= 63 &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/u.test(label),
  );
}

function normalizeTls(value: unknown): RedisTlsOptions {
  if (typeof value !== 'object' || value === null || capturedIsProxy(value)) {
    unavailable();
  }

  const enabledDescriptor = capturedGetOwnPropertyDescriptor(value, 'enabled');

  if (enabledDescriptor === undefined || !('value' in enabledDescriptor)) {
    unavailable();
  }

  if (enabledDescriptor.value === false) {
    assertExactOrdinaryRecord(value, ['enabled']);
    return capturedFreeze({ enabled: false });
  }

  if (enabledDescriptor.value !== true) {
    unavailable();
  }

  const ownKeys = capturedReflectOwnKeys(value);

  if (ownKeys.length === 1 && ownKeys[0] === 'enabled') {
    assertExactOrdinaryRecord(value, ['enabled']);
    return capturedFreeze({ enabled: true });
  }

  assertExactOrdinaryRecord(value, ['certificateAuthority', 'enabled']);
  const certificateAuthority = boundedString(
    readDataProperty(value, 'certificateAuthority'),
    1,
    1_048_576,
  );

  return capturedFreeze({ certificateAuthority, enabled: true });
}

function readOption(record: object, name: ConnectionOptionName): unknown {
  return readDataProperty(record, name);
}

export function normalizeRedisConnectionOptions(value: unknown): RedisConnectionOptions {
  try {
    const record = assertExactOrdinaryRecord(value, CONNECTION_OPTION_KEYS);
    const host = boundedString(readOption(record, 'host'), 1, 253);

    if (!validRedisHost(host)) {
      unavailable();
    }

    const username = boundedString(readOption(record, 'username'), 1, 128);

    if (/[\s\p{Cc}]/u.test(username)) {
      unavailable();
    }

    const normalized = {
      commandQueueLimit: boundedInteger(readOption(record, 'commandQueueLimit'), 1, 10_000),
      commandTimeoutMilliseconds: boundedInteger(
        readOption(record, 'commandTimeoutMilliseconds'),
        25,
        500,
      ),
      connectTimeoutMilliseconds: boundedInteger(
        readOption(record, 'connectTimeoutMilliseconds'),
        100,
        5_000,
      ),
      host,
      password: boundedString(readOption(record, 'password'), 1, 8_192),
      port: boundedInteger(readOption(record, 'port'), 1, 65_535),
      probeTimeoutMilliseconds: boundedInteger(
        readOption(record, 'probeTimeoutMilliseconds'),
        25,
        5_000,
      ),
      shutdownTimeoutMilliseconds: boundedInteger(
        readOption(record, 'shutdownTimeoutMilliseconds'),
        100,
        10_000,
      ),
      tls: normalizeTls(readOption(record, 'tls')),
      username,
    } satisfies RedisConnectionOptions;

    return capturedFreeze(normalized);
  } catch {
    unavailable();
  }
}
