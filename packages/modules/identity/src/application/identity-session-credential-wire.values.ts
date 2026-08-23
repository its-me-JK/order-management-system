import {
  InvalidIdentityAccessCredentialWireValueError,
  InvalidIdentityRefreshCredentialWireValueError,
} from './identity-session-credential.errors';

export const IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX = 'oms_at_v1_';
export const IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX = 'oms_rt_v1_';
export const IDENTITY_SESSION_CREDENTIAL_PAYLOAD_LENGTH = 43;
export const IDENTITY_SESSION_CREDENTIAL_WIRE_VALUE_LENGTH = 53;
export const IDENTITY_SESSION_CREDENTIAL_CANONICAL_FINAL_SEXTET_MASK = 0x03;
export const IDENTITY_SESSION_CREDENTIAL_CANONICAL_FINAL_CHARACTERS = 'AEIMQUYcgkosw048';

const REDACTED_IDENTITY_SESSION_CREDENTIAL = '[REDACTED]';
const IDENTITY_SESSION_CREDENTIAL_PAYLOAD_PATTERN = /^[A-Za-z0-9_-]{43}(?![\s\S])/u;

declare const identityAccessCredentialWireValueBrand: unique symbol;
declare const identityRefreshCredentialWireValueBrand: unique symbol;

export type IdentityAccessCredentialWireValue = Readonly<{
  readonly [identityAccessCredentialWireValueBrand]: true;
}>;

export type IdentityRefreshCredentialWireValue = Readonly<{
  readonly [identityRefreshCredentialWireValueBrand]: true;
}>;

const identityAccessCredentialWireValues = new WeakMap<object, string>();
const identityRefreshCredentialWireValues = new WeakMap<object, string>();

function invalidAccessCredentialWireValue(): never {
  throw new InvalidIdentityAccessCredentialWireValueError();
}

function invalidRefreshCredentialWireValue(): never {
  throw new InvalidIdentityRefreshCredentialWireValueError();
}

function parseCanonicalWireValue(value: unknown, prefix: string, invalid: () => never): string {
  if (typeof value !== 'string' || value.length !== IDENTITY_SESSION_CREDENTIAL_WIRE_VALUE_LENGTH) {
    invalid();
  }

  if (!value.startsWith(prefix)) {
    invalid();
  }

  const payload = value.slice(prefix.length);

  if (
    payload.length !== IDENTITY_SESSION_CREDENTIAL_PAYLOAD_LENGTH ||
    !IDENTITY_SESSION_CREDENTIAL_PAYLOAD_PATTERN.test(payload) ||
    !IDENTITY_SESSION_CREDENTIAL_CANONICAL_FINAL_CHARACTERS.includes(payload.at(-1) ?? '')
  ) {
    invalid();
  }

  return value;
}

class IdentityAccessCredentialWireValueRuntime {
  public constructor(value: unknown) {
    if (new.target !== IdentityAccessCredentialWireValueRuntime) {
      invalidAccessCredentialWireValue();
    }

    identityAccessCredentialWireValues.set(
      this,
      parseCanonicalWireValue(
        value,
        IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX,
        invalidAccessCredentialWireValue,
      ),
    );
    Object.freeze(this);
  }

  public toJSON(): string {
    return REDACTED_IDENTITY_SESSION_CREDENTIAL;
  }

  public toString(): string {
    return REDACTED_IDENTITY_SESSION_CREDENTIAL;
  }

  public [Symbol.toPrimitive](): string {
    return REDACTED_IDENTITY_SESSION_CREDENTIAL;
  }
}

class IdentityRefreshCredentialWireValueRuntime {
  public constructor(value: unknown) {
    if (new.target !== IdentityRefreshCredentialWireValueRuntime) {
      invalidRefreshCredentialWireValue();
    }

    identityRefreshCredentialWireValues.set(
      this,
      parseCanonicalWireValue(
        value,
        IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX,
        invalidRefreshCredentialWireValue,
      ),
    );
    Object.freeze(this);
  }

  public toJSON(): string {
    return REDACTED_IDENTITY_SESSION_CREDENTIAL;
  }

  public toString(): string {
    return REDACTED_IDENTITY_SESSION_CREDENTIAL;
  }

  public [Symbol.toPrimitive](): string {
    return REDACTED_IDENTITY_SESSION_CREDENTIAL;
  }
}

Object.freeze(IdentityAccessCredentialWireValueRuntime.prototype);
Object.freeze(IdentityAccessCredentialWireValueRuntime);
Object.freeze(IdentityRefreshCredentialWireValueRuntime.prototype);
Object.freeze(IdentityRefreshCredentialWireValueRuntime);

export function parseIdentityAccessCredentialWireValue(
  value: unknown,
): IdentityAccessCredentialWireValue {
  if (
    typeof value === 'object' &&
    value !== null &&
    identityAccessCredentialWireValues.has(value)
  ) {
    return value as IdentityAccessCredentialWireValue;
  }

  return new IdentityAccessCredentialWireValueRuntime(
    value,
  ) as unknown as IdentityAccessCredentialWireValue;
}

export function parseIdentityRefreshCredentialWireValue(
  value: unknown,
): IdentityRefreshCredentialWireValue {
  if (
    typeof value === 'object' &&
    value !== null &&
    identityRefreshCredentialWireValues.has(value)
  ) {
    return value as IdentityRefreshCredentialWireValue;
  }

  return new IdentityRefreshCredentialWireValueRuntime(
    value,
  ) as unknown as IdentityRefreshCredentialWireValue;
}

export function serializeIdentityAccessCredentialWireValue(
  value: IdentityAccessCredentialWireValue,
): string {
  const candidate: unknown = value;
  const serialized =
    typeof candidate === 'object' && candidate !== null
      ? identityAccessCredentialWireValues.get(candidate)
      : undefined;

  if (serialized === undefined) {
    invalidAccessCredentialWireValue();
  }

  return serialized;
}

export function serializeIdentityRefreshCredentialWireValue(
  value: IdentityRefreshCredentialWireValue,
): string {
  const candidate: unknown = value;
  const serialized =
    typeof candidate === 'object' && candidate !== null
      ? identityRefreshCredentialWireValues.get(candidate)
      : undefined;

  if (serialized === undefined) {
    invalidRefreshCredentialWireValue();
  }

  return serialized;
}
