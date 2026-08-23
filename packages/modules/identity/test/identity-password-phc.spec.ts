import { inspect } from 'node:util';

import {
  IDENTITY_ARGON2_SALT_BYTES,
  IDENTITY_ARGON2_TAG_BYTES,
  IdentityPasswordPhc,
  InvalidIdentityPasswordPhcError,
  MAX_IDENTITY_ARGON2_ITERATIONS,
  MAX_IDENTITY_ARGON2_LANES,
  MAX_IDENTITY_ARGON2_MEMORY_KIB,
  MAX_IDENTITY_PASSWORD_PHC_ASCII_LENGTH,
  MIN_IDENTITY_ARGON2_ITERATIONS,
  MIN_IDENTITY_ARGON2_LANES,
  MIN_IDENTITY_ARGON2_MEMORY_KIB,
  identityPasswordPhcsEqual,
  parseIdentityPasswordPhc,
  serializeIdentityPasswordPhc,
} from '../src/domain/identity-password-phc';

const SALT = 'AAAAAAAAAAAAAAAAAAAAAA';
const TAG = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const DIFFERENT_TAG = `B${TAG.slice(1)}`;
const DEFAULT_PHC = `$argon2id$v=19$m=65536,t=3,p=1$${SALT}$${TAG}`;
const REDACTED = '[REDACTED]';
const STANDARD_BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

type PhcParts = Readonly<{
  algorithm?: string;
  version?: string;
  memoryKiB?: string;
  iterations?: string;
  lanes?: string;
  salt?: string;
  tag?: string;
}>;

function phc(parts: PhcParts = {}): string {
  return `$${parts.algorithm ?? 'argon2id'}$v=${parts.version ?? '19'}$m=${parts.memoryKiB ?? '65536'},t=${parts.iterations ?? '3'},p=${parts.lanes ?? '1'}$${parts.salt ?? SALT}$${parts.tag ?? TAG}`;
}

function captureError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error;
    }
  }

  throw new Error('Expected the operation to throw an Error');
}

function expectFixedPhcError(value: unknown): void {
  const error = captureError(() => parseIdentityPasswordPhc(value));

  expect(error).toBeInstanceOf(InvalidIdentityPasswordPhcError);
  expect(error).toMatchObject({
    message: 'Expected a canonical supported Identity Argon2id PHC value',
    name: 'InvalidIdentityPasswordPhcError',
  });
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();

  if (typeof value === 'string' && value.length > 0) {
    expect(String(error)).not.toContain(value);
    expect(JSON.stringify(error)).not.toContain(value);
  }
}

describe('IdentityPasswordPhc canonical representation', (): void => {
  it.each([
    [
      'minimum envelope',
      phc({
        memoryKiB: String(MIN_IDENTITY_ARGON2_MEMORY_KIB),
        iterations: String(MIN_IDENTITY_ARGON2_ITERATIONS),
        lanes: String(MIN_IDENTITY_ARGON2_LANES),
      }),
    ],
    ['reviewed default', DEFAULT_PHC],
    [
      'maximum envelope',
      phc({
        memoryKiB: String(MAX_IDENTITY_ARGON2_MEMORY_KIB),
        iterations: String(MAX_IDENTITY_ARGON2_ITERATIONS),
        lanes: String(MAX_IDENTITY_ARGON2_LANES),
      }),
    ],
  ])('accepts the %s and retains its exact bytes', (_scenario, encoded): void => {
    const parsed = parseIdentityPasswordPhc(encoded);

    expect(parsed).toBeInstanceOf(IdentityPasswordPhc);
    expect(serializeIdentityPasswordPhc(parsed)).toBe(encoded);
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it('fixes the salt, tag, and complete ASCII envelope sizes', (): void => {
    expect(IDENTITY_ARGON2_SALT_BYTES).toBe(16);
    expect(IDENTITY_ARGON2_TAG_BYTES).toBe(32);
    expect(SALT).toHaveLength(22);
    expect(TAG).toHaveLength(43);
    expect(
      phc({
        memoryKiB: String(MAX_IDENTITY_ARGON2_MEMORY_KIB),
        iterations: String(MAX_IDENTITY_ARGON2_ITERATIONS),
        lanes: String(MAX_IDENTITY_ARGON2_LANES),
      }),
    ).toHaveLength(MAX_IDENTITY_PASSWORD_PHC_ASCII_LENGTH);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['number', 65_536],
    ['array', [DEFAULT_PHC]],
    ['plain object', { value: DEFAULT_PHC }],
    ['empty string', ''],
    ['oversized input', 'A'.repeat(MAX_IDENTITY_PASSWORD_PHC_ASCII_LENGTH + 1)],
    ['leading whitespace', ` ${DEFAULT_PHC}`],
    ['trailing whitespace', `${DEFAULT_PHC} `],
    ['trailing line feed', `${DEFAULT_PHC}\n`],
    ['trailing carriage return', `${DEFAULT_PHC}\r`],
    ['trailing CRLF', `${DEFAULT_PHC}\r\n`],
    ['embedded newline', DEFAULT_PHC.replace('$m=', '$\nm=')],
    ['embedded NUL', DEFAULT_PHC.replace('$m=', '$\0m=')],
    ['non-ASCII', DEFAULT_PHC.replace('argon2id', 'argon2íd')],
    ['Argon2i algorithm', phc({ algorithm: 'argon2i' })],
    ['Argon2d algorithm', phc({ algorithm: 'argon2d' })],
    ['uppercase algorithm', phc({ algorithm: 'Argon2id' })],
    ['version 16', phc({ version: '16' })],
    ['version with a leading zero', phc({ version: '019' })],
    ['memory below the envelope', phc({ memoryKiB: '19455' })],
    ['memory above the envelope', phc({ memoryKiB: '131073' })],
    ['memory with a leading zero', phc({ memoryKiB: '065536' })],
    ['memory with a plus sign', phc({ memoryKiB: '+65536' })],
    ['memory with a minus sign', phc({ memoryKiB: '-65536' })],
    ['memory with a decimal fraction', phc({ memoryKiB: '65536.0' })],
    ['iterations below the envelope', phc({ iterations: '1' })],
    ['iterations above the envelope', phc({ iterations: '7' })],
    ['iterations with a leading zero', phc({ iterations: '03' })],
    ['lanes below the envelope', phc({ lanes: '0' })],
    ['lanes above the envelope', phc({ lanes: '5' })],
    ['lanes with a leading zero', phc({ lanes: '01' })],
    ['short salt', phc({ salt: SALT.slice(1) })],
    ['long salt', phc({ salt: `${SALT}A` })],
    ['padded salt', phc({ salt: `${SALT.slice(0, -1)}=` })],
    ['Base64url salt', phc({ salt: `-${SALT.slice(1)}` })],
    ['noncanonical salt tail bits', phc({ salt: `${SALT.slice(0, -1)}B` })],
    ['short tag', phc({ tag: TAG.slice(1) })],
    ['long tag', phc({ tag: `${TAG}A` })],
    ['padded tag', phc({ tag: `${TAG.slice(0, -1)}=` })],
    ['Base64url tag', phc({ tag: `_${TAG.slice(1)}` })],
    ['noncanonical tag tail bits', phc({ tag: `${TAG.slice(0, -1)}B` })],
    ['reordered cost fields', `$argon2id$v=19$t=3,m=65536,p=1$${SALT}$${TAG}`],
    ['missing version', `$argon2id$m=65536,t=3,p=1$${SALT}$${TAG}`],
    ['missing cost field', `$argon2id$v=19$m=65536,t=3$${SALT}$${TAG}`],
    ['duplicated cost field', `$argon2id$v=19$m=65536,t=3,p=1,p=1$${SALT}$${TAG}`],
    ['optional key identifier', `$argon2id$v=19$m=65536,t=3,p=1,keyid=AA$${SALT}$${TAG}`],
    ['optional associated data', `$argon2id$v=19$m=65536,t=3,p=1,data=AA$${SALT}$${TAG}`],
    ['trailing field', `${DEFAULT_PHC}$extra`],
  ])('rejects %s with one fixed safe error', (_scenario, value): void => {
    expectFixedPhcError(value);
  });

  it('does not coerce a hostile non-string input', (): void => {
    const hostile = Object.freeze({
      toJSON(): never {
        throw new Error('The PHC parser must not serialize input');
      },
      toString(): never {
        throw new Error('The PHC parser must not stringify input');
      },
      [Symbol.toPrimitive](): never {
        throw new Error('The PHC parser must not coerce input');
      },
    });

    expect(() => parseIdentityPasswordPhc(hostile)).toThrow(InvalidIdentityPasswordPhcError);
  });

  it('does not execute hostile or revoked Proxy traps while recognizing opaque values', (): void => {
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf(): never {
          throw new Error('sensitive-proxy-trap');
        },
      },
    );
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();

    for (const value of [hostile, revocable.proxy]) {
      const error = captureError(() => parseIdentityPasswordPhc(value));

      expect(error).toBeInstanceOf(InvalidIdentityPasswordPhcError);
      expect(error.message).toBe('Expected a canonical supported Identity Argon2id PHC value');
      expect(String(error)).not.toContain('sensitive-proxy-trap');
      expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
    }
  });

  it('cannot bypass validation through the runtime constructor', (): void => {
    expect((): void => {
      Reflect.construct(IdentityPasswordPhc, ['not-a-phc']);
    }).toThrow(InvalidIdentityPasswordPhcError);
  });

  it('accepts exactly the canonical final Base64 sextets for a 16-byte salt', (): void => {
    for (let index = 0; index < STANDARD_BASE64_ALPHABET.length; index += 1) {
      const finalCharacter = STANDARD_BASE64_ALPHABET[index];

      if (finalCharacter === undefined) {
        throw new Error('Expected a Base64 alphabet character');
      }

      const candidate = phc({ salt: `${SALT.slice(0, -1)}${finalCharacter}` });

      if ((index & 0x0f) === 0) {
        expect(() => parseIdentityPasswordPhc(candidate)).not.toThrow();
      } else {
        expect(() => parseIdentityPasswordPhc(candidate)).toThrow(InvalidIdentityPasswordPhcError);
      }
    }
  });

  it('accepts exactly the canonical final Base64 sextets for a 32-byte tag', (): void => {
    for (let index = 0; index < STANDARD_BASE64_ALPHABET.length; index += 1) {
      const finalCharacter = STANDARD_BASE64_ALPHABET[index];

      if (finalCharacter === undefined) {
        throw new Error('Expected a Base64 alphabet character');
      }

      const candidate = phc({ tag: `${TAG.slice(0, -1)}${finalCharacter}` });

      if ((index & 0x03) === 0) {
        expect(() => parseIdentityPasswordPhc(candidate)).not.toThrow();
      } else {
        expect(() => parseIdentityPasswordPhc(candidate)).toThrow(InvalidIdentityPasswordPhcError);
      }
    }
  });
});

describe('IdentityPasswordPhc secret exposure boundary', (): void => {
  it('redacts ordinary coercion, JSON serialization, inspection, and property discovery', (): void => {
    const passwordPhc = parseIdentityPasswordPhc(DEFAULT_PHC);
    const snapshot = Object.freeze({ passwordPhc });

    expect(passwordPhc.toJSON()).toBe(REDACTED);
    expect(passwordPhc.toString()).toBe(REDACTED);
    expect(passwordPhc[Symbol.toPrimitive]()).toBe(REDACTED);
    expect(String(passwordPhc)).toBe(REDACTED);
    // Deliberately exercise native coercion syntax with the opaque value.
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    expect(`${passwordPhc}`).toBe(REDACTED);
    // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
    expect(passwordPhc + '').toBe(REDACTED);
    expect(JSON.stringify(passwordPhc)).toBe(JSON.stringify(REDACTED));
    expect(JSON.stringify(snapshot)).toBe(`{"passwordPhc":"${REDACTED}"}`);
    expect(Object.keys(passwordPhc)).toEqual([]);
    expect(Reflect.ownKeys(passwordPhc)).toEqual([]);
    expect({ ...(passwordPhc as unknown as Readonly<Record<string, unknown>>) }).toEqual({});
    expect(inspect(passwordPhc)).not.toContain(DEFAULT_PHC);
    expect(inspect(passwordPhc, { showHidden: true })).not.toContain(DEFAULT_PHC);
    expect(inspect(snapshot)).not.toContain(DEFAULT_PHC);
    expect(inspect(structuredClone(passwordPhc), { showHidden: true })).not.toContain(DEFAULT_PHC);
  });

  it('exposes exact bytes only through the deliberately named serializer', (): void => {
    const passwordPhc = parseIdentityPasswordPhc(DEFAULT_PHC);

    expect(serializeIdentityPasswordPhc(passwordPhc)).toBe(DEFAULT_PHC);
  });

  it('rejects a forged prototype instance through the serializer and equality helper', (): void => {
    const forged = Object.create(IdentityPasswordPhc.prototype) as IdentityPasswordPhc;
    const valid = parseIdentityPasswordPhc(DEFAULT_PHC);

    expect(() => serializeIdentityPasswordPhc(forged)).toThrow(InvalidIdentityPasswordPhcError);
    expect(() => identityPasswordPhcsEqual(forged, valid)).toThrow(InvalidIdentityPasswordPhcError);
    expect(() => identityPasswordPhcsEqual(valid, forged)).toThrow(InvalidIdentityPasswordPhcError);
  });
});

describe('IdentityPasswordPhc equality', (): void => {
  it('compares exact encoded values without exposing them', (): void => {
    const first = parseIdentityPasswordPhc(DEFAULT_PHC);
    const same = parseIdentityPasswordPhc(DEFAULT_PHC);
    const different = parseIdentityPasswordPhc(phc({ tag: DIFFERENT_TAG }));

    expect(first).not.toBe(same);
    expect(identityPasswordPhcsEqual(first, same)).toBe(true);
    expect(identityPasswordPhcsEqual(first, different)).toBe(false);
  });
});
