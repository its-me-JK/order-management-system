const IDENTITY_PASSWORD_PHC_PATTERN =
  /^\$argon2id\$v=19\$m=([1-9][0-9]*),t=([1-9][0-9]*),p=([1-9][0-9]*)\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})(?![\s\S])/u;
const STANDARD_BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const REDACTED_IDENTITY_PASSWORD_PHC = '[REDACTED]';
const MIN_IDENTITY_PASSWORD_PHC_ASCII_LENGTH = 97;

const identityPasswordPhcValues = new WeakMap<object, string>();

export const MIN_IDENTITY_ARGON2_MEMORY_KIB = 19_456;
export const MAX_IDENTITY_ARGON2_MEMORY_KIB = 131_072;
export const MIN_IDENTITY_ARGON2_ITERATIONS = 2;
export const MAX_IDENTITY_ARGON2_ITERATIONS = 6;
export const MIN_IDENTITY_ARGON2_LANES = 1;
export const MAX_IDENTITY_ARGON2_LANES = 4;
export const IDENTITY_ARGON2_SALT_BYTES = 16;
export const IDENTITY_ARGON2_TAG_BYTES = 32;
export const MAX_IDENTITY_PASSWORD_PHC_ASCII_LENGTH = 98;

export class InvalidIdentityPasswordPhcError extends Error {
  public constructor() {
    super('Expected a canonical supported Identity Argon2id PHC value');
    this.name = 'InvalidIdentityPasswordPhcError';
  }
}

function invalidIdentityPasswordPhc(): never {
  throw new InvalidIdentityPasswordPhcError();
}

function isAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    if (codeUnit > 0x7f) {
      return false;
    }
  }

  return true;
}

function hasCanonicalBase64Tail(value: string, unusedBitMask: number): boolean {
  const finalCharacter = value.at(-1);

  if (finalCharacter === undefined) {
    return false;
  }

  const finalSextet = STANDARD_BASE64_ALPHABET.indexOf(finalCharacter);

  return finalSextet >= 0 && (finalSextet & unusedBitMask) === 0;
}

function parseCanonicalIdentityPasswordPhc(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < MIN_IDENTITY_PASSWORD_PHC_ASCII_LENGTH ||
    value.length > MAX_IDENTITY_PASSWORD_PHC_ASCII_LENGTH ||
    !isAscii(value)
  ) {
    invalidIdentityPasswordPhc();
  }

  const match = IDENTITY_PASSWORD_PHC_PATTERN.exec(value);
  const memoryKiBText = match?.[1];
  const iterationsText = match?.[2];
  const lanesText = match?.[3];
  const salt = match?.[4];
  const tag = match?.[5];

  if (
    memoryKiBText === undefined ||
    iterationsText === undefined ||
    lanesText === undefined ||
    salt === undefined ||
    tag === undefined
  ) {
    invalidIdentityPasswordPhc();
  }

  const memoryKiB = Number(memoryKiBText);
  const iterations = Number(iterationsText);
  const lanes = Number(lanesText);

  if (
    !Number.isSafeInteger(memoryKiB) ||
    memoryKiB < MIN_IDENTITY_ARGON2_MEMORY_KIB ||
    memoryKiB > MAX_IDENTITY_ARGON2_MEMORY_KIB ||
    !Number.isSafeInteger(iterations) ||
    iterations < MIN_IDENTITY_ARGON2_ITERATIONS ||
    iterations > MAX_IDENTITY_ARGON2_ITERATIONS ||
    !Number.isSafeInteger(lanes) ||
    lanes < MIN_IDENTITY_ARGON2_LANES ||
    lanes > MAX_IDENTITY_ARGON2_LANES ||
    !hasCanonicalBase64Tail(salt, 0x0f) ||
    !hasCanonicalBase64Tail(tag, 0x03)
  ) {
    invalidIdentityPasswordPhc();
  }

  return value;
}

function encodedIdentityPasswordPhc(phc: IdentityPasswordPhc): string {
  const encoded = identityPasswordPhcValues.get(phc);

  if (encoded === undefined) {
    invalidIdentityPasswordPhc();
  }

  return encoded;
}

/**
 * Opaque password verifier. Ordinary coercion and serialization are always
 * redacted; only the deliberately named serializer exposes the stored value.
 */
export class IdentityPasswordPhc {
  private constructor(value: unknown) {
    identityPasswordPhcValues.set(this, parseCanonicalIdentityPasswordPhc(value));
    Object.freeze(this);
  }

  public static parse(value: unknown): IdentityPasswordPhc {
    if (typeof value === 'object' && value !== null && identityPasswordPhcValues.has(value)) {
      return value as IdentityPasswordPhc;
    }

    return new IdentityPasswordPhc(value);
  }

  public toJSON(): string {
    return REDACTED_IDENTITY_PASSWORD_PHC;
  }

  public toString(): string {
    return REDACTED_IDENTITY_PASSWORD_PHC;
  }

  public [Symbol.toPrimitive](): string {
    return REDACTED_IDENTITY_PASSWORD_PHC;
  }
}

export function parseIdentityPasswordPhc(value: unknown): IdentityPasswordPhc {
  return IdentityPasswordPhc.parse(value);
}

/** The sole raw-value escape hatch for persistence and cryptographic adapters. */
export function serializeIdentityPasswordPhc(phc: IdentityPasswordPhc): string {
  return encodedIdentityPasswordPhc(phc);
}

/** Exact encoded equality for transaction revalidation; this does not verify a password. */
export function identityPasswordPhcsEqual(
  left: IdentityPasswordPhc,
  right: IdentityPasswordPhc,
): boolean {
  return encodedIdentityPasswordPhc(left) === encodedIdentityPasswordPhc(right);
}
