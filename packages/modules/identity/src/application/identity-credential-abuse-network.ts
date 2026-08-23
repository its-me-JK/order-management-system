const capturedArrayBuffer = ArrayBuffer;
const capturedFreeze = Object.freeze;
const capturedGetPrototypeOf = Object.getPrototypeOf;
const capturedReflectApply = Reflect.apply;
const capturedUint8Array = Uint8Array;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedUint8ArraySet = Uint8Array.prototype.set;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakMapGet = WeakMap.prototype.get;
// eslint-disable-next-line @typescript-eslint/unbound-method
const capturedWeakMapSet = WeakMap.prototype.set;

const typedArrayPrototype = capturedGetPrototypeOf(Uint8Array.prototype) as object;
const typedArrayBufferDescriptor = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer');
const typedArrayByteLengthDescriptor = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'byteLength',
);
const typedArrayByteOffsetDescriptor = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'byteOffset',
);
const typedArrayKindDescriptor = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
);
const arrayBufferResizableDescriptor = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'resizable',
);
const arrayBufferByteLengthDescriptor = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
);

const IPV4_ADDRESS_BYTE_LENGTH = 4;
const IPV6_ADDRESS_BYTE_LENGTH = 16;
const IPV6_ABUSE_PREFIX_BYTE_LENGTH = 8;
const KEY_HEADER_BYTE_LENGTH = 2;
const KEY_FORMAT_VERSION = 1;
const IPV4_FAMILY_TAG = 4;
const IPV6_FAMILY_TAG = 6;
const REDACTED_IDENTITY_CREDENTIAL_ABUSE_NETWORK = '[REDACTED]';
const NETWORK_CONSTRUCTION_CAPABILITY = capturedFreeze({});

const identityCredentialAbuseNetworkKeyBytes = new WeakMap<object, Uint8Array<ArrayBuffer>>();

declare const identityCredentialAbuseNetworkBrand: unique symbol;

export type IdentityCredentialAbuseNetworkAddressFamily = 'ipv4' | 'ipv6';

export type IdentityCredentialAbuseNetwork = IdentityCredentialAbuseNetworkValue &
  Readonly<{
    [identityCredentialAbuseNetworkBrand]: true;
  }>;

export class InvalidIdentityCredentialAbuseNetworkError extends Error {
  public constructor() {
    super('Expected a canonical Identity credential abuse network');
    this.name = 'InvalidIdentityCredentialAbuseNetworkError';
  }
}

function invalidNetwork(): never {
  throw new InvalidIdentityCredentialAbuseNetworkError();
}

function readTypedArrayBuffer(value: Uint8Array): ArrayBufferLike {
  if (typedArrayBufferDescriptor?.get === undefined) {
    invalidNetwork();
  }

  // eslint-disable-next-line @typescript-eslint/unbound-method
  return capturedReflectApply(typedArrayBufferDescriptor.get, value, []) as ArrayBufferLike;
}

function readTypedArrayByteLength(value: Uint8Array): number {
  if (typedArrayByteLengthDescriptor?.get === undefined) {
    invalidNetwork();
  }

  // eslint-disable-next-line @typescript-eslint/unbound-method
  return capturedReflectApply(typedArrayByteLengthDescriptor.get, value, []) as number;
}

function readTypedArrayByteOffset(value: Uint8Array): number {
  if (typedArrayByteOffsetDescriptor?.get === undefined) {
    invalidNetwork();
  }

  // eslint-disable-next-line @typescript-eslint/unbound-method
  return capturedReflectApply(typedArrayByteOffsetDescriptor.get, value, []) as number;
}

function readTypedArrayKind(value: Uint8Array): unknown {
  if (typedArrayKindDescriptor?.get === undefined) {
    invalidNetwork();
  }

  // eslint-disable-next-line @typescript-eslint/unbound-method
  return capturedReflectApply(typedArrayKindDescriptor.get, value, []);
}

function isResizableArrayBuffer(value: ArrayBuffer): boolean {
  if (arrayBufferResizableDescriptor?.get === undefined) {
    invalidNetwork();
  }

  // eslint-disable-next-line @typescript-eslint/unbound-method
  return capturedReflectApply(arrayBufferResizableDescriptor.get, value, []) as boolean;
}

function readArrayBufferByteLength(value: ArrayBuffer): number {
  if (arrayBufferByteLengthDescriptor?.get === undefined) {
    invalidNetwork();
  }

  // eslint-disable-next-line @typescript-eslint/unbound-method
  return capturedReflectApply(arrayBufferByteLengthDescriptor.get, value, []) as number;
}

function assertOrdinaryFixedKeyBytes(value: Uint8Array<ArrayBuffer>): void {
  const backingStore = readTypedArrayBuffer(value);
  const byteLength = readTypedArrayByteLength(value);

  if (
    !(backingStore instanceof capturedArrayBuffer) ||
    isResizableArrayBuffer(backingStore) ||
    readTypedArrayKind(value) !== 'Uint8Array' ||
    readTypedArrayByteOffset(value) !== 0 ||
    readArrayBufferByteLength(backingStore) !== byteLength
  ) {
    invalidNetwork();
  }
}

function copyValidatedAddressBytes(
  value: unknown,
  expectedByteLength: number,
): Uint8Array<ArrayBuffer> {
  if (!(value instanceof capturedUint8Array) || readTypedArrayKind(value) !== 'Uint8Array') {
    invalidNetwork();
  }

  const backingStore = readTypedArrayBuffer(value);

  if (
    !(backingStore instanceof capturedArrayBuffer) ||
    isResizableArrayBuffer(backingStore) ||
    readTypedArrayByteLength(value) !== expectedByteLength
  ) {
    invalidNetwork();
  }

  const copy: Uint8Array<ArrayBuffer> = new capturedUint8Array(expectedByteLength);
  capturedReflectApply(capturedUint8ArraySet, copy, [value]);
  assertOrdinaryFixedKeyBytes(copy);

  if (
    readTypedArrayBuffer(value) !== backingStore ||
    readTypedArrayByteLength(value) !== expectedByteLength ||
    readTypedArrayKind(value) !== 'Uint8Array'
  ) {
    invalidNetwork();
  }

  for (let index = 0; index < expectedByteLength; index += 1) {
    if (copy[index] !== value[index]) {
      invalidNetwork();
    }
  }

  return copy;
}

function isIpv4MappedIpv6Address(value: Uint8Array<ArrayBuffer>): boolean {
  for (let index = 0; index < 10; index += 1) {
    if (value[index] !== 0) {
      return false;
    }
  }

  return value[10] === 0xff && value[11] === 0xff;
}

function createKeyBytes(family: unknown, addressBytes: unknown): Uint8Array<ArrayBuffer> {
  if (family === 'ipv4') {
    const address = copyValidatedAddressBytes(addressBytes, IPV4_ADDRESS_BYTE_LENGTH);
    const key = new capturedUint8Array(KEY_HEADER_BYTE_LENGTH + IPV4_ADDRESS_BYTE_LENGTH);
    key[0] = KEY_FORMAT_VERSION;
    key[1] = IPV4_FAMILY_TAG;
    capturedReflectApply(capturedUint8ArraySet, key, [address, KEY_HEADER_BYTE_LENGTH]);
    assertOrdinaryFixedKeyBytes(key);

    return key;
  }

  if (family === 'ipv6') {
    const address = copyValidatedAddressBytes(addressBytes, IPV6_ADDRESS_BYTE_LENGTH);

    if (isIpv4MappedIpv6Address(address)) {
      const key = new capturedUint8Array(KEY_HEADER_BYTE_LENGTH + IPV4_ADDRESS_BYTE_LENGTH);
      key[0] = KEY_FORMAT_VERSION;
      key[1] = IPV4_FAMILY_TAG;

      for (let index = 0; index < IPV4_ADDRESS_BYTE_LENGTH; index += 1) {
        const addressByte = address[12 + index];

        if (addressByte === undefined) {
          invalidNetwork();
        }

        key[KEY_HEADER_BYTE_LENGTH + index] = addressByte;
      }

      assertOrdinaryFixedKeyBytes(key);

      return key;
    }

    const key = new capturedUint8Array(KEY_HEADER_BYTE_LENGTH + IPV6_ABUSE_PREFIX_BYTE_LENGTH);
    key[0] = KEY_FORMAT_VERSION;
    key[1] = IPV6_FAMILY_TAG;

    for (let index = 0; index < IPV6_ABUSE_PREFIX_BYTE_LENGTH; index += 1) {
      const addressByte = address[index];

      if (addressByte === undefined) {
        invalidNetwork();
      }

      key[KEY_HEADER_BYTE_LENGTH + index] = addressByte;
    }

    assertOrdinaryFixedKeyBytes(key);

    return key;
  }

  invalidNetwork();
}

function copyStoredKeyBytes(value: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const copy: Uint8Array<ArrayBuffer> = new capturedUint8Array(readTypedArrayByteLength(value));
  capturedReflectApply(capturedUint8ArraySet, copy, [value]);
  assertOrdinaryFixedKeyBytes(copy);

  return copy;
}

class IdentityCredentialAbuseNetworkValue {
  public constructor(capability: unknown, keyBytes: Uint8Array<ArrayBuffer>) {
    if (
      new.target !== IdentityCredentialAbuseNetworkValue ||
      capability !== NETWORK_CONSTRUCTION_CAPABILITY
    ) {
      invalidNetwork();
    }

    capturedReflectApply(capturedWeakMapSet, identityCredentialAbuseNetworkKeyBytes, [
      this,
      keyBytes,
    ]);
    capturedFreeze(this);
  }

  public toJSON(): string {
    return REDACTED_IDENTITY_CREDENTIAL_ABUSE_NETWORK;
  }

  public toString(): string {
    return REDACTED_IDENTITY_CREDENTIAL_ABUSE_NETWORK;
  }

  public [Symbol.toPrimitive](): string {
    return REDACTED_IDENTITY_CREDENTIAL_ABUSE_NETWORK;
  }
}

capturedFreeze(IdentityCredentialAbuseNetworkValue.prototype);
capturedFreeze(IdentityCredentialAbuseNetworkValue);

/**
 * Converts one already-parsed IP address into Identity's canonical abuse-network capability.
 *
 * Text parsing and trusted-proxy selection remain transport-adapter responsibilities. IPv4
 * retains the individual address; native IPv6 retains only its /64 prefix; IPv4-mapped IPv6
 * collapses into the equivalent IPv4 namespace.
 */
export function createIdentityCredentialAbuseNetworkFromAddressBytes(
  family: IdentityCredentialAbuseNetworkAddressFamily,
  addressBytes: unknown,
): IdentityCredentialAbuseNetwork {
  try {
    const keyBytes = createKeyBytes(family, addressBytes);

    return new IdentityCredentialAbuseNetworkValue(
      NETWORK_CONSTRUCTION_CAPABILITY,
      keyBytes,
    ) as IdentityCredentialAbuseNetwork;
  } catch {
    invalidNetwork();
  }
}

/** @internal Verifies a network capability produced by this module. */
export function authenticateIdentityCredentialAbuseNetwork(
  value: unknown,
): IdentityCredentialAbuseNetwork {
  try {
    if (typeof value !== 'object' || value === null) {
      invalidNetwork();
    }

    const keyBytes = capturedReflectApply(
      capturedWeakMapGet,
      identityCredentialAbuseNetworkKeyBytes,
      [value],
    ) as Uint8Array<ArrayBuffer> | undefined;

    if (keyBytes === undefined) {
      invalidNetwork();
    }

    return value as IdentityCredentialAbuseNetwork;
  } catch {
    invalidNetwork();
  }
}

/** @internal Returns an isolated copy for the Identity abuse-key adapter. */
export function copyIdentityCredentialAbuseNetworkKeyBytes(
  value: IdentityCredentialAbuseNetwork,
): Uint8Array<ArrayBuffer> {
  try {
    const keyBytes = capturedReflectApply(
      capturedWeakMapGet,
      identityCredentialAbuseNetworkKeyBytes,
      [value],
    ) as Uint8Array<ArrayBuffer> | undefined;

    if (keyBytes === undefined) {
      invalidNetwork();
    }

    return copyStoredKeyBytes(keyBytes);
  } catch {
    invalidNetwork();
  }
}
