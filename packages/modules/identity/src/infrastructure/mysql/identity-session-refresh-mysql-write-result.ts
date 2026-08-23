import { isProxy } from 'node:util/types';

const OK_PACKET_KEYS = Object.freeze(['affectedRows', 'insertId', 'warningStatus'] as const);
const OK_PACKET_PROTOTYPE_KEYS = Object.freeze(['constructor'] as const);
const objectPrototype = Object.prototype;
const capturedFreeze = Object.freeze;
const capturedGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedHasOwn = Object.hasOwn;
const capturedIsArray = Array.isArray;
const capturedIsProxy = isProxy;
const capturedOwnKeys = Reflect.ownKeys;

export type IdentitySessionRefreshMySqlWriteResult =
  Readonly<{ kind: 'changed' }> | Readonly<{ kind: 'no-match' }> | Readonly<{ kind: 'malformed' }>;

const CHANGED: IdentitySessionRefreshMySqlWriteResult = capturedFreeze({ kind: 'changed' });
const NO_MATCH: IdentitySessionRefreshMySqlWriteResult = capturedFreeze({ kind: 'no-match' });
const MALFORMED: IdentitySessionRefreshMySqlWriteResult = capturedFreeze({ kind: 'malformed' });

function hasExactKeys(actual: readonly PropertyKey[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;

  // Indexing avoids granting mutable Array iterator authority in this decoder boundary.
  // eslint-disable-next-line @typescript-eslint/prefer-for-of
  for (let actualIndex = 0; actualIndex < actual.length; actualIndex += 1) {
    const actualKey = actual[actualIndex];

    if (typeof actualKey !== 'string') return false;
    let matched = false;

    // eslint-disable-next-line @typescript-eslint/prefer-for-of
    for (let expectedIndex = 0; expectedIndex < expected.length; expectedIndex += 1) {
      if (actualKey === expected[expectedIndex]) {
        matched = true;
        break;
      }
    }

    if (!matched) return false;
  }

  return true;
}

function isExpectedDataDescriptor(
  descriptor: PropertyDescriptor | undefined,
  enumerable: boolean,
): descriptor is PropertyDescriptor & Readonly<{ value: unknown }> {
  return (
    descriptor !== undefined &&
    capturedHasOwn(descriptor, 'value') &&
    descriptor.writable === true &&
    descriptor.enumerable === enumerable &&
    descriptor.configurable === true
  );
}

function isMariaDbOkPacketPrototype(value: object): boolean {
  const prototype: unknown = capturedGetPrototypeOf(value);

  if (
    capturedIsProxy(prototype) ||
    typeof prototype !== 'object' ||
    prototype === null ||
    prototype === objectPrototype ||
    capturedGetPrototypeOf(prototype) !== objectPrototype ||
    !hasExactKeys(capturedOwnKeys(prototype), OK_PACKET_PROTOTYPE_KEYS)
  ) {
    return false;
  }

  const constructorDescriptor = capturedGetOwnPropertyDescriptor(prototype, 'constructor');

  return (
    isExpectedDataDescriptor(constructorDescriptor, false) &&
    typeof constructorDescriptor.value === 'function' &&
    !capturedIsProxy(constructorDescriptor.value)
  );
}

function decodeWriteResult(
  value: unknown,
  acceptNoMatch: boolean,
): IdentitySessionRefreshMySqlWriteResult {
  try {
    if (
      capturedIsProxy(value) ||
      typeof value !== 'object' ||
      value === null ||
      capturedIsArray(value) ||
      !isMariaDbOkPacketPrototype(value) ||
      !hasExactKeys(capturedOwnKeys(value), OK_PACKET_KEYS)
    ) {
      return MALFORMED;
    }

    const affectedRowsDescriptor = capturedGetOwnPropertyDescriptor(value, 'affectedRows');
    const insertIdDescriptor = capturedGetOwnPropertyDescriptor(value, 'insertId');
    const warningStatusDescriptor = capturedGetOwnPropertyDescriptor(value, 'warningStatus');

    if (
      !isExpectedDataDescriptor(affectedRowsDescriptor, true) ||
      !isExpectedDataDescriptor(insertIdDescriptor, true) ||
      !isExpectedDataDescriptor(warningStatusDescriptor, true) ||
      insertIdDescriptor.value !== 0n ||
      warningStatusDescriptor.value !== 0
    ) {
      return MALFORMED;
    }

    if (affectedRowsDescriptor.value === 1) return CHANGED;
    return acceptNoMatch && affectedRowsDescriptor.value === 0 ? NO_MATCH : MALFORMED;
  } catch {
    return MALFORMED;
  }
}

/** @internal Total decoder for a conditional single-row Identity refresh write. */
export function decodeIdentitySessionRefreshConditionalMySqlWriteResult(
  this: undefined,
  value: unknown,
): IdentitySessionRefreshMySqlWriteResult {
  return decodeWriteResult(value, true);
}

/** @internal Total decoder for an exact single-row Identity refresh insert. */
export function decodeIdentitySessionRefreshInsertMySqlWriteResult(
  this: undefined,
  value: unknown,
): IdentitySessionRefreshMySqlWriteResult {
  return decodeWriteResult(value, false);
}
