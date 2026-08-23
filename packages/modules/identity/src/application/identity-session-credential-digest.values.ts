import {
  InvalidIdentityAccessCredentialDigestError,
  InvalidIdentityRefreshCredentialDigestError,
} from './identity-session-credential.errors';

export const IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH = 32;
const REDACTED_IDENTITY_SESSION_CREDENTIAL_DIGEST = '[REDACTED]';

const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype) as object;
const typedArrayBufferDescriptor = Object.getOwnPropertyDescriptor(typedArrayPrototype, 'buffer');
const typedArrayByteLengthDescriptor = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'byteLength',
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

const identityAccessCredentialDigestBytes = new WeakMap<object, Uint8Array<ArrayBuffer>>();
const identityRefreshCredentialDigestBytes = new WeakMap<object, Uint8Array<ArrayBuffer>>();

declare const identityAccessCredentialDigestBrand: unique symbol;
declare const identityRefreshCredentialDigestBrand: unique symbol;

function invalidDigestRepresentation(): never {
  throw new TypeError('Invalid credential digest representation');
}

function readTypedArrayBuffer(value: Uint8Array): ArrayBufferLike {
  if (typedArrayBufferDescriptor?.get === undefined) {
    invalidDigestRepresentation();
  }

  return typedArrayBufferDescriptor.get.call(value) as ArrayBufferLike;
}

function readTypedArrayByteLength(value: Uint8Array): number {
  if (typedArrayByteLengthDescriptor?.get === undefined) {
    invalidDigestRepresentation();
  }

  return typedArrayByteLengthDescriptor.get.call(value) as number;
}

function readTypedArrayKind(value: Uint8Array): unknown {
  if (typedArrayKindDescriptor?.get === undefined) {
    invalidDigestRepresentation();
  }

  return typedArrayKindDescriptor.get.call(value);
}

function isResizableArrayBuffer(value: ArrayBuffer): boolean {
  if (arrayBufferResizableDescriptor?.get === undefined) {
    invalidDigestRepresentation();
  }

  return arrayBufferResizableDescriptor.get.call(value) as boolean;
}

function readArrayBufferByteLength(value: ArrayBuffer): number {
  if (arrayBufferByteLengthDescriptor?.get === undefined) {
    invalidDigestRepresentation();
  }

  return arrayBufferByteLengthDescriptor.get.call(value) as number;
}

function assertFixedDigestCopy(value: Uint8Array<ArrayBuffer>): void {
  const backingStore = readTypedArrayBuffer(value);

  if (
    !(backingStore instanceof ArrayBuffer) ||
    isResizableArrayBuffer(backingStore) ||
    readTypedArrayByteLength(value) !== IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH ||
    readArrayBufferByteLength(backingStore) !== IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH ||
    value.byteOffset !== 0
  ) {
    invalidDigestRepresentation();
  }
}

function copyValidatedDigestBytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array) || readTypedArrayKind(value) !== 'Uint8Array') {
    invalidDigestRepresentation();
  }

  const backingStore = readTypedArrayBuffer(value);

  if (
    !(backingStore instanceof ArrayBuffer) ||
    isResizableArrayBuffer(backingStore) ||
    readTypedArrayByteLength(value) !== IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH
  ) {
    invalidDigestRepresentation();
  }

  const copy: Uint8Array<ArrayBuffer> = new Uint8Array(
    IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH,
  );
  copy.set(value);
  assertFixedDigestCopy(copy);

  if (
    readTypedArrayBuffer(value) !== backingStore ||
    readTypedArrayByteLength(value) !== IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH
  ) {
    invalidDigestRepresentation();
  }

  for (let index = 0; index < IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH; index += 1) {
    if (copy[index] !== value[index]) {
      invalidDigestRepresentation();
    }
  }

  return copy;
}

function copyStoredDigestBytes(value: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  const copy: Uint8Array<ArrayBuffer> = new Uint8Array(
    IDENTITY_SESSION_CREDENTIAL_DIGEST_BYTE_LENGTH,
  );
  copy.set(value);
  assertFixedDigestCopy(copy);

  return copy;
}

function invalidAccessDigest(): never {
  throw new InvalidIdentityAccessCredentialDigestError();
}

function invalidRefreshDigest(): never {
  throw new InvalidIdentityRefreshCredentialDigestError();
}

class IdentityAccessCredentialDigestValue {
  private constructor(value: unknown) {
    try {
      if (new.target !== IdentityAccessCredentialDigestValue) {
        invalidAccessDigest();
      }

      identityAccessCredentialDigestBytes.set(this, copyValidatedDigestBytes(value));
      Object.freeze(this);
    } catch {
      invalidAccessDigest();
    }
  }

  public static create(value: unknown): IdentityAccessCredentialDigestValue {
    return new IdentityAccessCredentialDigestValue(value);
  }

  public toJSON(): string {
    return REDACTED_IDENTITY_SESSION_CREDENTIAL_DIGEST;
  }

  public toString(): string {
    return REDACTED_IDENTITY_SESSION_CREDENTIAL_DIGEST;
  }

  public [Symbol.toPrimitive](): string {
    return REDACTED_IDENTITY_SESSION_CREDENTIAL_DIGEST;
  }
}

class IdentityRefreshCredentialDigestValue {
  private constructor(value: unknown) {
    try {
      if (new.target !== IdentityRefreshCredentialDigestValue) {
        invalidRefreshDigest();
      }

      identityRefreshCredentialDigestBytes.set(this, copyValidatedDigestBytes(value));
      Object.freeze(this);
    } catch {
      invalidRefreshDigest();
    }
  }

  public static create(value: unknown): IdentityRefreshCredentialDigestValue {
    return new IdentityRefreshCredentialDigestValue(value);
  }

  public toJSON(): string {
    return REDACTED_IDENTITY_SESSION_CREDENTIAL_DIGEST;
  }

  public toString(): string {
    return REDACTED_IDENTITY_SESSION_CREDENTIAL_DIGEST;
  }

  public [Symbol.toPrimitive](): string {
    return REDACTED_IDENTITY_SESSION_CREDENTIAL_DIGEST;
  }
}

Object.freeze(IdentityAccessCredentialDigestValue.prototype);
Object.freeze(IdentityAccessCredentialDigestValue);
Object.freeze(IdentityRefreshCredentialDigestValue.prototype);
Object.freeze(IdentityRefreshCredentialDigestValue);

export type IdentityAccessCredentialDigest = IdentityAccessCredentialDigestValue &
  Readonly<{
    [identityAccessCredentialDigestBrand]: true;
  }>;

export type IdentityRefreshCredentialDigest = IdentityRefreshCredentialDigestValue &
  Readonly<{
    [identityRefreshCredentialDigestBrand]: true;
  }>;

export function createIdentityAccessCredentialDigestFromBytes(
  value: unknown,
): IdentityAccessCredentialDigest {
  try {
    if (
      typeof value === 'object' &&
      value !== null &&
      identityAccessCredentialDigestBytes.has(value)
    ) {
      return value as IdentityAccessCredentialDigest;
    }

    return IdentityAccessCredentialDigestValue.create(value) as IdentityAccessCredentialDigest;
  } catch {
    invalidAccessDigest();
  }
}

export function createIdentityRefreshCredentialDigestFromBytes(
  value: unknown,
): IdentityRefreshCredentialDigest {
  try {
    if (
      typeof value === 'object' &&
      value !== null &&
      identityRefreshCredentialDigestBytes.has(value)
    ) {
      return value as IdentityRefreshCredentialDigest;
    }

    return IdentityRefreshCredentialDigestValue.create(value) as IdentityRefreshCredentialDigest;
  } catch {
    invalidRefreshDigest();
  }
}

export function copyIdentityAccessCredentialDigestBytes(
  value: IdentityAccessCredentialDigest,
): Uint8Array<ArrayBuffer> {
  try {
    const stored = identityAccessCredentialDigestBytes.get(value);

    if (stored === undefined) {
      invalidAccessDigest();
    }

    return copyStoredDigestBytes(stored);
  } catch {
    invalidAccessDigest();
  }
}

export function copyIdentityRefreshCredentialDigestBytes(
  value: IdentityRefreshCredentialDigest,
): Uint8Array<ArrayBuffer> {
  try {
    const stored = identityRefreshCredentialDigestBytes.get(value);

    if (stored === undefined) {
      invalidRefreshDigest();
    }

    return copyStoredDigestBytes(stored);
  } catch {
    invalidRefreshDigest();
  }
}
