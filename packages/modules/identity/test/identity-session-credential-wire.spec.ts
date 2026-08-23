import { inspect } from 'node:util';

import {
  InvalidIdentityAccessCredentialWireValueError,
  InvalidIdentityRefreshCredentialWireValueError,
} from '../src/application/identity-session-credential.errors';
import {
  IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX,
  IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX,
  IDENTITY_SESSION_CREDENTIAL_CANONICAL_FINAL_CHARACTERS,
  IDENTITY_SESSION_CREDENTIAL_CANONICAL_FINAL_SEXTET_MASK,
  IDENTITY_SESSION_CREDENTIAL_PAYLOAD_LENGTH,
  IDENTITY_SESSION_CREDENTIAL_WIRE_VALUE_LENGTH,
  parseIdentityAccessCredentialWireValue,
  parseIdentityRefreshCredentialWireValue,
  serializeIdentityAccessCredentialWireValue,
  serializeIdentityRefreshCredentialWireValue,
  type IdentityAccessCredentialWireValue,
  type IdentityRefreshCredentialWireValue,
} from '../src/application/identity-session-credential-wire.values';

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const ACCESS_WIRE_VALUE = `${IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(42)}A`;
const REFRESH_WIRE_VALUE = `${IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX}${'B'.repeat(42)}E`;
const REDACTED = '[REDACTED]';

type ErrorClass = abstract new (...arguments_: never[]) => Error;
type RuntimeCredential = Readonly<{
  constructor: new (value: unknown) => object;
  toJSON(): string;
  toString(): string;
  [Symbol.toPrimitive](): string;
}>;

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

function expectFixedSafeError(
  operation: () => unknown,
  expectedClass: ErrorClass,
  expectedName: string,
  expectedMessage: string,
  rejectedValues: readonly string[] = [],
): void {
  const error = captureError(operation);

  expect(error).toBeInstanceOf(expectedClass);
  expect(error).toMatchObject({ name: expectedName, message: expectedMessage });
  expect((error as Error & { cause?: unknown }).cause).toBeUndefined();

  for (const rejectedValue of rejectedValues) {
    if (rejectedValue.length === 0) {
      continue;
    }

    expect(String(error)).not.toContain(rejectedValue);
    expect(JSON.stringify(error)).not.toContain(rejectedValue);
  }
}

function expectInvalidAccess(value: unknown, rejectedValues: readonly string[] = []): void {
  expectFixedSafeError(
    () => parseIdentityAccessCredentialWireValue(value),
    InvalidIdentityAccessCredentialWireValueError,
    'InvalidIdentityAccessCredentialWireValueError',
    'Expected a canonical Identity access credential wire value',
    rejectedValues,
  );
}

function expectInvalidRefresh(value: unknown, rejectedValues: readonly string[] = []): void {
  expectFixedSafeError(
    () => parseIdentityRefreshCredentialWireValue(value),
    InvalidIdentityRefreshCredentialWireValueError,
    'InvalidIdentityRefreshCredentialWireValueError',
    'Expected a canonical Identity refresh credential wire value',
    rejectedValues,
  );
}

describe('Identity session credential wire policy', (): void => {
  it('fixes the reviewed prefixes and exact encoded lengths', (): void => {
    expect(IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX).toBe('oms_at_v1_');
    expect(IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX).toBe('oms_rt_v1_');
    expect(IDENTITY_SESSION_CREDENTIAL_PAYLOAD_LENGTH).toBe(43);
    expect(IDENTITY_SESSION_CREDENTIAL_WIRE_VALUE_LENGTH).toBe(53);
    expect(ACCESS_WIRE_VALUE).toHaveLength(53);
    expect(REFRESH_WIRE_VALUE).toHaveLength(53);
  });

  it('accepts exactly the sixteen canonical final Base64url sextets', (): void => {
    expect(IDENTITY_SESSION_CREDENTIAL_CANONICAL_FINAL_SEXTET_MASK).toBe(0x03);
    expect(IDENTITY_SESSION_CREDENTIAL_CANONICAL_FINAL_CHARACTERS).toBe('AEIMQUYcgkosw048');

    for (const finalCharacter of IDENTITY_SESSION_CREDENTIAL_CANONICAL_FINAL_CHARACTERS) {
      const access = `${IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(42)}${finalCharacter}`;
      const refresh = `${IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(
        42,
      )}${finalCharacter}`;

      expect(
        serializeIdentityAccessCredentialWireValue(parseIdentityAccessCredentialWireValue(access)),
      ).toBe(access);
      expect(
        serializeIdentityRefreshCredentialWireValue(
          parseIdentityRefreshCredentialWireValue(refresh),
        ),
      ).toBe(refresh);
    }
  });

  it('rejects all forty-eight non-canonical Base64url final sextets', (): void => {
    const nonCanonicalFinalCharacters = Array.from(BASE64URL_ALPHABET).filter(
      (character) => !IDENTITY_SESSION_CREDENTIAL_CANONICAL_FINAL_CHARACTERS.includes(character),
    );

    expect(nonCanonicalFinalCharacters).toHaveLength(48);

    for (const finalCharacter of nonCanonicalFinalCharacters) {
      expectInvalidAccess(
        `${IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(42)}${finalCharacter}`,
      );
      expectInvalidRefresh(
        `${IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(42)}${finalCharacter}`,
      );
    }
  });

  it('accepts every Base64url alphabet character before the canonical tail', (): void => {
    for (const character of BASE64URL_ALPHABET) {
      const payload = `${'A'.repeat(41)}${character}A`;
      const access = `${IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX}${payload}`;
      const refresh = `${IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX}${payload}`;

      expect(
        serializeIdentityAccessCredentialWireValue(parseIdentityAccessCredentialWireValue(access)),
      ).toBe(access);
      expect(
        serializeIdentityRefreshCredentialWireValue(
          parseIdentityRefreshCredentialWireValue(refresh),
        ),
      ).toBe(refresh);
    }
  });

  it.each([
    ['empty value', ''],
    ['short payload', `${IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(41)}A`],
    ['long payload', `${IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(43)}A`],
    ['wrong case', `OMS_at_v1_${'A'.repeat(43)}`],
    ['wrong kind', `${IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(43)}`],
    ['wrong version', `oms_at_v2_${'A'.repeat(43)}`],
    ['padding', `${IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(42)}=`],
    ['standard Base64 plus', `${IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(41)}+A`],
    ['standard Base64 slash', `${IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(41)}/A`],
    ['space', `${IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(41)} A`],
    ['line feed', `${IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(41)}\nA`],
    ['percent spelling', `${IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(40)}%2A`],
    ['non-ASCII', `${IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(41)}éA`],
  ] as const)('rejects access %s without repair', (_scenario, value): void => {
    expectInvalidAccess(value, [value]);
  });

  it.each([
    ['empty value', ''],
    ['short payload', `${IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(41)}A`],
    ['long payload', `${IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(43)}A`],
    ['wrong case', `OMS_rt_v1_${'A'.repeat(43)}`],
    ['wrong kind', `${IDENTITY_ACCESS_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(43)}`],
    ['wrong version', `oms_rt_v2_${'A'.repeat(43)}`],
    ['padding', `${IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(42)}=`],
    ['standard Base64 plus', `${IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(41)}+A`],
    ['standard Base64 slash', `${IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(41)}/A`],
    ['space', `${IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(41)} A`],
    ['carriage return', `${IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(41)}\rA`],
    ['percent spelling', `${IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(40)}%2A`],
    ['non-ASCII', `${IDENTITY_REFRESH_CREDENTIAL_WIRE_PREFIX}${'A'.repeat(41)}éA`],
  ] as const)('rejects refresh %s without repair', (_scenario, value): void => {
    expectInvalidRefresh(value, [value]);
  });
});

describe('Identity session credential wire runtime boundary', (): void => {
  it('parses idempotently and preserves the exact canonical values', (): void => {
    const access = parseIdentityAccessCredentialWireValue(ACCESS_WIRE_VALUE);
    const refresh = parseIdentityRefreshCredentialWireValue(REFRESH_WIRE_VALUE);

    expect(parseIdentityAccessCredentialWireValue(access)).toBe(access);
    expect(parseIdentityRefreshCredentialWireValue(refresh)).toBe(refresh);
    expect(serializeIdentityAccessCredentialWireValue(access)).toBe(ACCESS_WIRE_VALUE);
    expect(serializeIdentityRefreshCredentialWireValue(refresh)).toBe(REFRESH_WIRE_VALUE);
  });

  it('keeps access and refresh namespaces distinct at runtime', (): void => {
    const access = parseIdentityAccessCredentialWireValue(ACCESS_WIRE_VALUE);
    const refresh = parseIdentityRefreshCredentialWireValue(REFRESH_WIRE_VALUE);

    expectInvalidAccess(refresh);
    expectInvalidRefresh(access);
    expectFixedSafeError(
      () =>
        serializeIdentityAccessCredentialWireValue(
          refresh as unknown as IdentityAccessCredentialWireValue,
        ),
      InvalidIdentityAccessCredentialWireValueError,
      'InvalidIdentityAccessCredentialWireValueError',
      'Expected a canonical Identity access credential wire value',
    );
    expectFixedSafeError(
      () =>
        serializeIdentityRefreshCredentialWireValue(
          access as unknown as IdentityRefreshCredentialWireValue,
        ),
      InvalidIdentityRefreshCredentialWireValueError,
      'InvalidIdentityRefreshCredentialWireValueError',
      'Expected a canonical Identity refresh credential wire value',
    );
  });

  it('redacts ordinary inspection and exposes no own secret-bearing fields', (): void => {
    const access = parseIdentityAccessCredentialWireValue(ACCESS_WIRE_VALUE);
    const refresh = parseIdentityRefreshCredentialWireValue(REFRESH_WIRE_VALUE);

    for (const [wireValue, secret] of [
      [access, ACCESS_WIRE_VALUE],
      [refresh, REFRESH_WIRE_VALUE],
    ] as const) {
      const runtime = wireValue as unknown as RuntimeCredential;

      expect(Object.isFrozen(wireValue)).toBe(true);
      expect(Object.keys(wireValue)).toEqual([]);
      expect(Reflect.ownKeys(wireValue)).toEqual([]);
      expect({ ...wireValue }).toEqual({});
      expect(runtime.toJSON()).toBe(REDACTED);
      expect(runtime.toString()).toBe(REDACTED);
      expect(runtime[Symbol.toPrimitive]()).toBe(REDACTED);
      expect(String(runtime)).toBe(REDACTED);
      expect(JSON.stringify(wireValue)).toBe(JSON.stringify(REDACTED));
      expect(JSON.stringify({ wireValue })).toBe(`{"wireValue":"${REDACTED}"}`);
      expect(inspect(wireValue)).not.toContain(secret);
      expect(inspect({ wireValue })).not.toContain(secret);
    }
  });

  it('validates recovered runtime constructors and rejects subclass construction', (): void => {
    const access = parseIdentityAccessCredentialWireValue(ACCESS_WIRE_VALUE);
    const refresh = parseIdentityRefreshCredentialWireValue(REFRESH_WIRE_VALUE);
    const AccessConstructor = (access as unknown as RuntimeCredential).constructor;
    const RefreshConstructor = (refresh as unknown as RuntimeCredential).constructor;
    const recoveredAccess = new AccessConstructor(ACCESS_WIRE_VALUE);
    const recoveredRefresh = new RefreshConstructor(REFRESH_WIRE_VALUE);

    expect(
      serializeIdentityAccessCredentialWireValue(
        recoveredAccess as IdentityAccessCredentialWireValue,
      ),
    ).toBe(ACCESS_WIRE_VALUE);
    expect(
      serializeIdentityRefreshCredentialWireValue(
        recoveredRefresh as IdentityRefreshCredentialWireValue,
      ),
    ).toBe(REFRESH_WIRE_VALUE);
    expectFixedSafeError(
      () => new AccessConstructor('recovered-access-constructor-secret'),
      InvalidIdentityAccessCredentialWireValueError,
      'InvalidIdentityAccessCredentialWireValueError',
      'Expected a canonical Identity access credential wire value',
      ['recovered-access-constructor-secret'],
    );
    expectFixedSafeError(
      () => new RefreshConstructor('recovered-refresh-constructor-secret'),
      InvalidIdentityRefreshCredentialWireValueError,
      'InvalidIdentityRefreshCredentialWireValueError',
      'Expected a canonical Identity refresh credential wire value',
      ['recovered-refresh-constructor-secret'],
    );

    class ForgedAccessSubclass extends AccessConstructor {}
    class ForgedRefreshSubclass extends RefreshConstructor {}

    expectFixedSafeError(
      () => new ForgedAccessSubclass(ACCESS_WIRE_VALUE),
      InvalidIdentityAccessCredentialWireValueError,
      'InvalidIdentityAccessCredentialWireValueError',
      'Expected a canonical Identity access credential wire value',
    );
    expectFixedSafeError(
      () => new ForgedRefreshSubclass(REFRESH_WIRE_VALUE),
      InvalidIdentityRefreshCredentialWireValueError,
      'InvalidIdentityRefreshCredentialWireValueError',
      'Expected a canonical Identity refresh credential wire value',
    );
  });

  it('rejects forgeries, proxies, structured clones, boxed strings, and raw serialization', (): void => {
    const access = parseIdentityAccessCredentialWireValue(ACCESS_WIRE_VALUE);
    const refresh = parseIdentityRefreshCredentialWireValue(REFRESH_WIRE_VALUE);
    const forgedAccess: unknown = Object.create(Reflect.getPrototypeOf(access));
    const forgedRefresh: unknown = Object.create(Reflect.getPrototypeOf(refresh));
    const proxiedAccess = new Proxy(access, {});
    const proxiedRefresh = new Proxy(refresh, {});
    const revokedAccess = Proxy.revocable(access, {});
    const revokedRefresh = Proxy.revocable(refresh, {});
    revokedAccess.revoke();
    revokedRefresh.revoke();

    for (const invalid of [
      forgedAccess,
      proxiedAccess,
      revokedAccess.proxy,
      structuredClone(access),
      new String(ACCESS_WIRE_VALUE),
    ]) {
      expectInvalidAccess(invalid);
      expectFixedSafeError(
        () =>
          serializeIdentityAccessCredentialWireValue(invalid as IdentityAccessCredentialWireValue),
        InvalidIdentityAccessCredentialWireValueError,
        'InvalidIdentityAccessCredentialWireValueError',
        'Expected a canonical Identity access credential wire value',
      );
    }

    for (const invalid of [
      forgedRefresh,
      proxiedRefresh,
      revokedRefresh.proxy,
      structuredClone(refresh),
      new String(REFRESH_WIRE_VALUE),
    ]) {
      expectInvalidRefresh(invalid);
      expectFixedSafeError(
        () =>
          serializeIdentityRefreshCredentialWireValue(
            invalid as IdentityRefreshCredentialWireValue,
          ),
        InvalidIdentityRefreshCredentialWireValueError,
        'InvalidIdentityRefreshCredentialWireValueError',
        'Expected a canonical Identity refresh credential wire value',
      );
    }

    expectFixedSafeError(
      () =>
        serializeIdentityAccessCredentialWireValue(
          ACCESS_WIRE_VALUE as unknown as IdentityAccessCredentialWireValue,
        ),
      InvalidIdentityAccessCredentialWireValueError,
      'InvalidIdentityAccessCredentialWireValueError',
      'Expected a canonical Identity access credential wire value',
      [ACCESS_WIRE_VALUE],
    );
    expectFixedSafeError(
      () =>
        serializeIdentityRefreshCredentialWireValue(
          REFRESH_WIRE_VALUE as unknown as IdentityRefreshCredentialWireValue,
        ),
      InvalidIdentityRefreshCredentialWireValueError,
      'InvalidIdentityRefreshCredentialWireValueError',
      'Expected a canonical Identity refresh credential wire value',
      [REFRESH_WIRE_VALUE],
    );
  });

  it('does not invoke hostile coercion or Proxy traps while rejecting input', (): void => {
    const secret = 'hostile-wire-value-secret';
    let calls = 0;
    const hostileObject = {
      toString(): never {
        calls += 1;
        throw new Error(secret);
      },
      valueOf(): never {
        calls += 1;
        throw new Error(secret);
      },
      [Symbol.toPrimitive](): never {
        calls += 1;
        throw new Error(secret);
      },
    };
    const hostileProxy = new Proxy(hostileObject, {
      get(): never {
        calls += 1;
        throw new Error(secret);
      },
      getPrototypeOf(): never {
        calls += 1;
        throw new Error(secret);
      },
    });

    expectInvalidAccess(hostileObject, [secret]);
    expectInvalidRefresh(hostileObject, [secret]);
    expectInvalidAccess(hostileProxy, [secret]);
    expectInvalidRefresh(hostileProxy, [secret]);
    expectFixedSafeError(
      () =>
        serializeIdentityAccessCredentialWireValue(
          hostileProxy as unknown as IdentityAccessCredentialWireValue,
        ),
      InvalidIdentityAccessCredentialWireValueError,
      'InvalidIdentityAccessCredentialWireValueError',
      'Expected a canonical Identity access credential wire value',
      [secret],
    );
    expect(calls).toBe(0);
  });

  it('rejects non-string primitives and oversized input without coercion', (): void => {
    for (const invalid of [undefined, null, false, true, 0, 1n, Symbol('wire-secret')]) {
      expectInvalidAccess(invalid);
      expectInvalidRefresh(invalid);
    }

    const oversized = `oversized-wire-secret-${'A'.repeat(100_000)}`;
    expectInvalidAccess(oversized, [oversized]);
    expectInvalidRefresh(oversized, [oversized]);
  });
});

const _accessWireValue: IdentityAccessCredentialWireValue =
  parseIdentityAccessCredentialWireValue(ACCESS_WIRE_VALUE);
const _refreshWireValue: IdentityRefreshCredentialWireValue =
  parseIdentityRefreshCredentialWireValue(REFRESH_WIRE_VALUE);

// @ts-expect-error Access and refresh wire values are nominally distinct.
const _wrongRefreshWireValue: IdentityRefreshCredentialWireValue = _accessWireValue;
// @ts-expect-error Access and refresh wire values are nominally distinct.
const _wrongAccessWireValue: IdentityAccessCredentialWireValue = _refreshWireValue;

void _wrongRefreshWireValue;
void _wrongAccessWireValue;
